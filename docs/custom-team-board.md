# Azure DevOps MCP Guide

This guide shows how to interact with Azure DevOps boards and work items using the MCP server.

## Prerequisites

- Azure DevOps MCP server configured in `.mcp.json`
- Appropriate permissions to access the project and team

## Configuration

Your `.mcp.json` should contain:

```json
{
  "mcpServers": {
    "azureDevOps": {
      "command": "npx",
      "args": ["-y", "@microsoft/azure-devops-mcp-server"],
      "env": {
        "AZURE_DEVOPS_ORG_URL": "{{AZURE_DEVOPS_ORG_URL}}",
        "AZURE_DEVOPS_PROJECT": "{{PROJECT_NAME}}",
        "AZURE_DEVOPS_AUTH_METHOD": "pat",
        "AZURE_DEVOPS_PAT": "{{YOUR_PAT}}",
      }
    }
  }
}
```

## Available Operations

### 1. List Projects

List all available projects in your organization:

```typescript
// MCP Tool: mcp__azureDevOps__list_projects
await mcp__azureDevOps__list_projects({});
```

### 2. Get Project Teams

Get all teams (boards) in a project:

```typescript
// MCP Tool: mcp__azureDevOps__get_project_details
await mcp__azureDevOps__get_project_details({
  projectId: "{{PROJECT_NAME}}",
  includeTeams: true
});
```

**Example Response:**
```json
{
  "name": "{{PROJECT_NAME}}",
  "teams": [
    {
      "id": "{{TEAM_ID}}",
      "name": "{{TEAM_NAME}}",
      "description": ""
    }
  ]
}
```

### 3. List Work Items

List work items in a project:

```typescript
// MCP Tool: mcp__azureDevOps__list_work_items
await mcp__azureDevOps__list_work_items({
  projectId: "{{PROJECT_NAME}}",
  top: 50
});
```

### 4. Get Work Item Details

Get full details of a specific work item including area path:

```typescript
// MCP Tool: mcp__azureDevOps__get_work_item
await mcp__azureDevOps__get_work_item({
  workItemId: {{WORK_ITEM_ID}},
  expand: "all"
});
```

**Key Fields:**
- `System.AreaPath` - The area path for the team (e.g., `{{PROJECT_NAME}}\{{TEAM_NAME}}`)
- `System.IterationPath` - The sprint/iteration path
- `System.State` - Current state (New, Active, Closed, etc.)
- `System.AssignedTo` - Assigned user

### 5. Create Work Item

Create a new work item (Epic, Feature, Task, Bug, User Story):

```typescript
// MCP Tool: mcp__azureDevOps__create_work_item
await mcp__azureDevOps__create_work_item({
  projectId: "{{PROJECT_NAME}}",
  workItemType: "Epic",
  title: "My test epic",
  description: "<p>Mytest description</p>",
  areaPath: "{{PROJECT_NAME}}\\{{TEAM_NAME}}",
  assignedTo: "{{DOMAIN}}\\username"  // Optional
});
```

**Note:** Use the area path format `{{PROJECT_NAME}}\\{{TEAM_NAME}}` to assign to a specific team's board.

### 6. Update Work Item

Update an existing work item:

```typescript
// MCP Tool: mcp__azureDevOps__update_work_item
await mcp__azureDevOps__update_work_item({
  workItemId: {{WORK_ITEM_ID}},
  state: "Active",
  assignedTo: "{{DOMAIN}}\\username",
  title: "Updated title"
});
```

### 7. Search Work Items

Search for work items across projects:

```typescript
// MCP Tool: mcp__azureDevOps__search_work_items
await mcp__azureDevOps__search_work_items({
  searchText: "WiPix",
  projectId: "{{PROJECT_NAME}}",
  top: 50
});
```

### 8. Link Work Items

Create parent-child or related links between work items:

```typescript
// MCP Tool: mcp__azureDevOps__manage_work_item_link
await mcp__azureDevOps__manage_work_item_link({
  sourceWorkItemId: {{PARENT_WORK_ITEM_ID}},  // Parent Epic
  targetWorkItemId: {{CHILD_WORK_ITEM_ID}},  // Child Feature
  operation: "add",
  relationType: "System.LinkTypes.Hierarchy-Forward"
});
```

## Area Path Convention

Area paths follow this pattern:
```
{{PROJECT_NAME}}\{{TEAM_NAME}}
```

For example:
- `{{PROJECT_NAME}}` - Default project area
- `{{PROJECT_NAME}}\{{TEAM_NAME}}` - {{TEAM_NAME}} team's area
- `{{PROJECT_NAME}}\{{EXAMPLE_TEAM_NAME}}` - {{EXAMPLE_TEAM_NAME}} team's area

## Work Item Types

Common work item types (depends on process template):
- **Epic** - Large initiative
- **Feature** - Deliverable for an epic
- **User Story** - User-facing requirement
- **Task** - Unit of work
- **Bug** - Defect to fix

## Direct Board URLs

You can access boards directly via web browser:

```
{{AZURE_DEVOPS_ORG_URL}}/{Project}/_boards/board/t/{Team}/Stories
```

Example for {{TEAM_NAME}}:
```
{{AZURE_DEVOPS_ORG_URL}}/{{PROJECT_NAME}}/_boards/board/t/{{TEAM_NAME}}/Stories
```

## Quick Reference: {{TEAM_NAME}} Team

| Property | Value |
|----------|-------|
| Project | {{PROJECT_NAME}} |
| Team Name | {{TEAM_NAME}} |
| Team ID | {{TEAM_ID}} |
| Area Path | {{PROJECT_NAME}}\{{TEAM_NAME}} |
| Board URL | {{AZURE_DEVOPS_ORG_URL}}/{{PROJECT_NAME}}/_boards/board/t/{{TEAM_NAME}}/Stories |

## Common Issues

### Issue: "The identity value is an unknown identity"
**Cause:** The assigned user email/username doesn't exist in Azure DevOps.

**Solution:** Use the correct Azure DevOps username format (e.g., `{{DOMAIN}}\username`) instead of email, or create without assignment and assign later via web portal.

### Issue: Cannot filter work items by team
**Cause:** The MCP doesn't support direct team filtering.

**Solution:** Use area path filtering when creating work items: `areaPath: "{{PROJECT_NAME}}\\{{TEAM_NAME}}"`

## Example: Create Epic in {{TEAM_NAME}} Board

```typescript
// 1. Get project details to find team ID
const project = await mcp__azureDevOps__get_project_details({
  projectId: "{{PROJECT_NAME}}",
  includeTeams: true
});

// 2. Create Epic with correct area path
const epic = await mcp__azureDevOps__create_work_item({
  projectId: "{{PROJECT_NAME}}",
  workItemType: "Epic",
  title: "Implement AI Agent Integration",
  description: "<p>Integrate AI Agent capabilities into the system</p>",
  areaPath: "{{PROJECT_NAME}}\\{{TEAM_NAME}}"
});

// 3. View the created Epic
console.log(`Epic created: ID ${epic.id}`);
console.log(`URL: ${epic._links.html.href}`);
```
