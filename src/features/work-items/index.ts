// Re-export schemas and types
export * from './schemas';
export * from './types';

// Re-export features
export * from './list-work-items';
export * from './get-work-item';
export * from './create-work-item';
export * from './update-work-item';
export * from './manage-work-item-link';

// Export tool definitions
export * from './tool-definitions';

// New exports for request handling
import { CallToolRequest } from '@modelcontextprotocol/sdk/types.js';
import { WebApi } from 'azure-devops-node-api';
import {
  RequestIdentifier,
  RequestHandler,
} from '../../shared/types/request-handler';
import { defaultProject } from '../../utils/environment';
import {
  ListWorkItemsSchema,
  GetWorkItemSchema,
  CreateWorkItemSchema,
  UpdateWorkItemSchema,
  ManageWorkItemLinkSchema,
  listWorkItems,
  getWorkItem,
  createWorkItem,
  updateWorkItem,
  manageWorkItemLink,
} from './';
import {
  validateTeamBoardAccess,
  fetchAndValidateWorkItem,
  getAllowedTeamIds,
  parseAllowedTeamBoards,
} from '../../utils/team-board-validation';
import { AzureDevOpsValidationError } from '../../shared/errors';
import { AzureDevOpsConfig } from '../../shared/types';
import { writeFileSync } from 'fs';
import { join } from 'path';

// Debug log file location
const DEBUG_LOG_PATH = join(
  process.env.USERPROFILE || process.env.HOME || '.',
  'mcp-azure-devops-debug.log',
);

function debugLog(message: string): void {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  process.stderr.write(logMessage);
  try {
    writeFileSync(DEBUG_LOG_PATH, logMessage, { flag: 'a' });
  } catch {
    // Ignore file write errors
  }
}

// Define the response type based on observed usage
interface CallToolResponse {
  content: Array<{ type: string; text: string }>;
}

/**
 * Checks if the request is for the work items feature
 */
export const isWorkItemsRequest: RequestIdentifier = (
  request: CallToolRequest,
): boolean => {
  const toolName = request.params.name;
  return [
    'get_work_item',
    'list_work_items',
    'create_work_item',
    'update_work_item',
    'manage_work_item_link',
  ].includes(toolName);
};

/**
 * Handles work items feature requests
 */
export const handleWorkItemsRequest: RequestHandler = async (
  connection: WebApi,
  request: CallToolRequest,
  config?: AzureDevOpsConfig,
): Promise<CallToolResponse> => {
  // DEBUG: Log config state
  debugLog(`handleWorkItemsRequest: config exists = ${!!config}`);
  if (config) {
    debugLog(
      `handleWorkItemsRequest: config.allowedTeamBoards = ${config.allowedTeamBoards}`,
    );
  }

  // Validate team board access if config is provided (applies to all work item operations)
  if (config) {
    await validateTeamBoardAccess(
      config,
      connection,
      defaultProject,
      undefined,
    );
  }

  switch (request.params.name) {
    case 'get_work_item': {
      const args = GetWorkItemSchema.parse(request.params.arguments);

      // If config is provided, fetch and validate the work item's team
      if (config) {
        const result = await fetchAndValidateWorkItem(
          config,
          connection,
          defaultProject,
          args.workItemId,
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      // No config, proceed without validation
      const result = await getWorkItem(
        connection,
        args.workItemId,
        args.expand,
      );
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
    case 'list_work_items': {
      const args = ListWorkItemsSchema.parse(request.params.arguments);
      const projectId = args.projectId ?? defaultProject;
      debugLog(`list_work_items: args.teamId = ${args.teamId}`);

      // If config is provided, handle team filtering
      if (config) {
        debugLog(`list_work_items: ENTERING CONFIG PATH`);
        const allowedTeams = parseAllowedTeamBoards(config.allowedTeamBoards);
        debugLog(
          `list_work_items: allowedTeams = ${JSON.stringify(allowedTeams)}`,
        );

        if (!allowedTeams || allowedTeams.length === 0) {
          debugLog(`list_work_items: NO ALLOWED TEAMS, THROWING ERROR`);
          throw new Error(
            'Board access is restricted. No team boards are configured in AZURE_DEVOPS_ALLOWED_TEAM_BOARDS. ' +
              'To enable board access, set AZURE_DEVOPS_ALLOWED_TEAM_BOARDS to a comma-separated list of team names.',
          );
        }

        // If teamId is provided, validate it and list work items for that team
        if (args.teamId) {
          debugLog(`list_work_items: USING TEAM ID PATH: ${args.teamId}`);
          await validateTeamBoardAccess(
            config,
            connection,
            projectId,
            args.teamId,
          );

          const result = await listWorkItems(connection, {
            projectId: projectId,
            teamId: args.teamId,
            queryId: args.queryId,
            wiql: args.wiql,
            top: args.top,
            skip: args.skip,
          });

          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        } else {
          debugLog(`list_work_items: USING AREA PATHS PATH`);
          // No teamId provided - get work items from all allowed teams using area paths
          const teamsData = await getAllowedTeamIds(
            connection,
            projectId,
            allowedTeams,
          );
          debugLog(`list_work_items: teamsData = ${JSON.stringify(teamsData)}`);

          // Build area path conditions for each team
          // Area paths are in format: Project\TeamName
          const areaPathConditions: string[] = [];
          for (const teamName of Object.keys(teamsData)) {
            // Area path format: Project\TeamName
            areaPathConditions.push(
              `[System.AreaPath] UNDER '${projectId}\\${teamName}'`,
            );
          }
          debugLog(
            `list_work_items: areaPathConditions = ${JSON.stringify(areaPathConditions)}`,
          );

          // Build WIQL query with area path filtering
          const wiql = `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${projectId}' AND (${areaPathConditions.join(' OR ')}) ORDER BY [System.Id]`;
          debugLog(`list_work_items: WIQL = ${wiql}`);

          // Query work items using the filtered WIQL
          const result = await listWorkItems(connection, {
            projectId: projectId,
            wiql: wiql,
            top: args.top,
            skip: args.skip,
          });

          debugLog(`list_work_items: final result count = ${result.length}`);

          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        }
      }

      debugLog(
        `list_work_items: FALLBACK PATH (NO CONFIG) - RETURNING ALL ITEMS`,
      );
      const result = await listWorkItems(connection, {
        projectId: projectId,
        teamId: args.teamId,
        queryId: args.queryId,
        wiql: args.wiql,
        top: args.top,
        skip: args.skip,
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
    case 'create_work_item': {
      const args = CreateWorkItemSchema.parse(request.params.arguments);
      const projectId = args.projectId ?? defaultProject;

      // If config is provided, handle area path defaulting based on allowed teams
      let effectiveAreaPath = args.areaPath;
      if (config && !effectiveAreaPath) {
        const allowedTeams = parseAllowedTeamBoards(config.allowedTeamBoards);

        if (allowedTeams && allowedTeams.length === 1) {
          // If only one team is allowed, automatically use that team's area path
          effectiveAreaPath = `${projectId}\\${allowedTeams[0]}`;
          debugLog(
            `create_work_item: Auto-setting areaPath to ${effectiveAreaPath}`,
          );
        } else if (allowedTeams && allowedTeams.length > 1) {
          // If multiple teams are allowed, require explicit area path
          throw new AzureDevOpsValidationError(
            `Multiple team boards are configured (${allowedTeams.join(', ')}). ` +
              `Please specify the areaPath parameter to indicate which team's area to create the work item in. ` +
              `Example: areaPath: '${projectId}\\${allowedTeams[0]}'`,
          );
        } else {
          // No allowed teams configured - block for security
          throw new AzureDevOpsValidationError(
            'Board access is restricted. No team boards are configured in AZURE_DEVOPS_ALLOWED_TEAM_BOARDS. ' +
              'To enable work item creation, set AZURE_DEVOPS_ALLOWED_TEAM_BOARDS to a comma-separated list of team names.',
          );
        }
      }

      const result = await createWorkItem(
        connection,
        projectId,
        args.workItemType,
        {
          title: args.title,
          description: args.description,
          acceptanceCriteria: args.acceptanceCriteria,
          assignedTo: args.assignedTo,
          areaPath: effectiveAreaPath,
          iterationPath: args.iterationPath,
          priority: args.priority,
          parentId: args.parentId,
          predecessorIds: args.predecessorIds,
          successorIds: args.successorIds,
          additionalFields: args.additionalFields,
        },
      );
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
    case 'update_work_item': {
      const args = UpdateWorkItemSchema.parse(request.params.arguments);

      // If config is provided, validate the work item's team before updating
      if (config) {
        await fetchAndValidateWorkItem(
          config,
          connection,
          defaultProject,
          args.workItemId,
        );
      }

      const result = await updateWorkItem(connection, args.workItemId, {
        title: args.title,
        description: args.description,
        acceptanceCriteria: args.acceptanceCriteria,
        assignedTo: args.assignedTo,
        areaPath: args.areaPath,
        iterationPath: args.iterationPath,
        priority: args.priority,
        state: args.state,
        predecessorIds: args.predecessorIds,
        successorIds: args.successorIds,
        additionalFields: args.additionalFields,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
    case 'manage_work_item_link': {
      const args = ManageWorkItemLinkSchema.parse(request.params.arguments);
      const projectId = args.projectId ?? defaultProject;

      // If config is provided, validate both work items' teams
      if (config) {
        await fetchAndValidateWorkItem(
          config,
          connection,
          projectId,
          args.sourceWorkItemId,
        );
        await fetchAndValidateWorkItem(
          config,
          connection,
          projectId,
          args.targetWorkItemId,
        );
      }

      const result = await manageWorkItemLink(connection, projectId, {
        sourceWorkItemId: args.sourceWorkItemId,
        targetWorkItemId: args.targetWorkItemId,
        operation: args.operation,
        relationType: args.relationType,
        newRelationType: args.newRelationType,
        comment: args.comment,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
    default:
      throw new Error(`Unknown work items tool: ${request.params.name}`);
  }
};
