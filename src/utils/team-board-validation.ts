import { WebApi } from 'azure-devops-node-api';
import {
  WorkItem,
  WorkItemExpand,
} from 'azure-devops-node-api/interfaces/WorkItemTrackingInterfaces';
import { WebApiTeam } from 'azure-devops-node-api/interfaces/CoreInterfaces';
import { AzureDevOpsValidationError } from '../shared/errors';
import { AzureDevOpsConfig } from '../shared/types';
import { writeFileSync } from 'fs';
import { join } from 'path';

// Cache for team data: { projectId: { teamName: teamId } }
const teamCache: Record<string, Record<string, string>> = {};

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

/**
 * Parse the allowedTeamBoards configuration into an array of team names
 */
export function parseAllowedTeamBoards(
  allowedTeamBoards?: string,
): string[] | null {
  debugLog(`parseAllowedTeamBoards: input = "${allowedTeamBoards}"`);
  if (!allowedTeamBoards || allowedTeamBoards.trim() === '') {
    debugLog(`parseAllowedTeamBoards: returning null`);
    return null;
  }
  const result = allowedTeamBoards
    .split(',')
    .map((team) => team.trim())
    .filter((team) => team.length > 0);
  debugLog(`parseAllowedTeamBoards: result = ${JSON.stringify(result)}`);
  return result;
}

/**
 * Get all teams for a project
 */
async function getAllTeams(
  connection: WebApi,
  projectId: string,
): Promise<WebApiTeam[]> {
  try {
    const coreApi = await connection.getCoreApi();
    return await coreApi.getTeams(projectId);
  } catch (error) {
    throw new AzureDevOpsValidationError(
      `Failed to get teams for project '${projectId}': ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Get the team name for a given team ID
 */
async function getTeamNameById(
  connection: WebApi,
  projectId: string,
  teamId: string,
): Promise<string | null> {
  // Check cache first
  if (teamCache[projectId]) {
    for (const [name, id] of Object.entries(teamCache[projectId])) {
      if (id === teamId) {
        return name;
      }
    }
  }

  // Not in cache, fetch from API
  const teams = await getAllTeams(connection, projectId);
  const team = teams.find((t) => t.id === teamId);

  if (team && team.name && team.id) {
    const teamName = team.name;
    const teamIdValue = team.id;
    // Update cache
    if (!teamCache[projectId]) {
      teamCache[projectId] = {};
    }
    teamCache[projectId][teamName.toLowerCase()] = teamIdValue;
    return teamName;
  }

  return null;
}

/**
 * Validate if a team is allowed based on the configuration
 */
export function isTeamAllowed(
  allowedTeamBoards: string[] | null,
  teamName: string,
): boolean {
  if (!allowedTeamBoards || allowedTeamBoards.length === 0) {
    return false;
  }
  return allowedTeamBoards.some(
    (allowedTeam) => allowedTeam.toLowerCase() === teamName.toLowerCase(),
  );
}

/**
 * Get team IDs for allowed team names
 * Returns a map of team name to team ID for allowed teams
 */
export async function getAllowedTeamIds(
  connection: WebApi,
  projectId: string,
  allowedTeamNames: string[],
): Promise<Record<string, { id: string }>> {
  const coreApi = await connection.getCoreApi();
  const allTeams = await coreApi.getTeams(projectId);

  // Build a map of team names to team IDs
  const teamMap: Record<string, string> = {};
  const notFound: string[] = [];

  for (const team of allTeams) {
    if (team.name && team.id) {
      teamMap[team.name.toLowerCase()] = team.id;

      // Cache for future lookups
      if (!teamCache[projectId]) {
        teamCache[projectId] = {};
      }
      teamCache[projectId][team.name.toLowerCase()] = team.id;
    }
  }

  // Build result map with only allowed teams
  const result: Record<string, { id: string }> = {};

  for (const teamName of allowedTeamNames) {
    const teamId = teamMap[teamName.toLowerCase()];
    if (teamId) {
      result[teamName] = { id: teamId };
    } else {
      notFound.push(teamName);
    }
  }

  if (notFound.length > 0) {
    throw new AzureDevOpsValidationError(
      `The following team boards are not found in project '${projectId}': ${notFound.join(', ')}. ` +
        `Available teams: ${allTeams
          .map((t) => t.name || 'Unknown')
          .filter(Boolean)
          .join(', ')}. ` +
        `Please check AZURE_DEVOPS_ALLOWED_TEAM_BOARDS configuration.`,
    );
  }

  return result;
}

/**
 * Get the team ID from a work item's fields
 */
function getWorkItemTeamId(workItem: WorkItem): string | undefined {
  // Try System.TeamId first
  const teamId = workItem.fields?.['System.TeamId'];
  if (teamId && typeof teamId === 'string') {
    return teamId;
  }
  return undefined;
}

/**
 * Get the area path from a work item's fields
 */
function getWorkItemAreaPath(workItem: WorkItem): string | undefined {
  const areaPath = workItem.fields?.['System.AreaPath'];
  if (areaPath && typeof areaPath === 'string') {
    return areaPath;
  }
  return undefined;
}

/**
 * Extract the team name from an area path
 * Area path format: Project\TeamName or Project\Path\TeamName
 */
function extractTeamNameFromAreaPath(
  areaPath: string,
  projectId: string,
): string | null {
  // Remove the project prefix if present
  let pathWithoutProject = areaPath;
  if (areaPath.startsWith(projectId + '\\')) {
    pathWithoutProject = areaPath.substring(projectId.length + 1);
  }

  // Split by backslash and get the first segment (which is typically the team name)
  const segments = pathWithoutProject.split('\\');
  if (segments.length > 0 && segments[0]) {
    return segments[0];
  }

  return null;
}

/**
 * Validate that a work item belongs to an allowed team
 */
export async function validateWorkItemTeamAccess(
  config: AzureDevOpsConfig,
  connection: WebApi,
  projectId: string,
  workItem: WorkItem,
): Promise<void> {
  const allowedTeams = parseAllowedTeamBoards(config.allowedTeamBoards);

  // If no allowed teams are configured, block all board access
  if (!allowedTeams || allowedTeams.length === 0) {
    throw new AzureDevOpsValidationError(
      'Board access is restricted. No team boards are configured in AZURE_DEVOPS_ALLOWED_TEAM_BOARDS. ' +
        'To enable board access, set AZURE_DEVOPS_ALLOWED_TEAM_BOARDS to a comma-separated list of team names.',
    );
  }

  // Get the team ID from the work item
  const workItemTeamId = getWorkItemTeamId(workItem);

  let teamName: string | null;

  if (workItemTeamId) {
    // Get the team name for this team ID
    teamName = await getTeamNameById(connection, projectId, workItemTeamId);

    if (!teamName) {
      throw new AzureDevOpsValidationError(
        `Cannot verify team board access for work item #${workItem.id}. ` +
          `Team ID '${workItemTeamId}' not found in project '${projectId}'. ` +
          `Please ensure the team exists and is configured in AZURE_DEVOPS_ALLOWED_TEAM_BOARDS.`,
      );
    }
  } else {
    // No System.TeamId, try to extract team from area path
    const areaPath = getWorkItemAreaPath(workItem);

    if (!areaPath) {
      throw new AzureDevOpsValidationError(
        `Cannot verify team board access for work item #${workItem.id}. ` +
          `The work item does not have an associated team or area path. ` +
          `Please ensure the work item is assigned to a team that is in AZURE_DEVOPS_ALLOWED_TEAM_BOARDS.`,
      );
    }

    teamName = extractTeamNameFromAreaPath(areaPath, projectId);

    if (!teamName) {
      throw new AzureDevOpsValidationError(
        `Cannot verify team board access for work item #${workItem.id}. ` +
          `Could not extract team name from area path '${areaPath}'. ` +
          `Please ensure the work item is assigned to a team that is in AZURE_DEVOPS_ALLOWED_TEAM_BOARDS.`,
      );
    }
  }

  // Check if the team is allowed
  if (!isTeamAllowed(allowedTeams, teamName)) {
    throw new AzureDevOpsValidationError(
      `Access denied. Work item #${workItem.id} belongs to team board '${teamName}' which is not in the allowed list. ` +
        `Allowed teams: ${allowedTeams.join(', ')}. ` +
        `Please add '${teamName}' to AZURE_DEVOPS_ALLOWED_TEAM_BOARDS if you need access.`,
    );
  }
}

/**
 * Validate team board access for listing work items
 * If no teamId is specified, still require allowed teams to be set
 */
export async function validateTeamBoardAccess(
  config: AzureDevOpsConfig,
  connection: WebApi,
  projectId: string,
  teamId?: string,
): Promise<void> {
  const allowedTeams = parseAllowedTeamBoards(config.allowedTeamBoards);

  // If no allowed teams are configured, block all board access
  if (!allowedTeams || allowedTeams.length === 0) {
    throw new AzureDevOpsValidationError(
      'Board access is restricted. No team boards are configured in AZURE_DEVOPS_ALLOWED_TEAM_BOARDS. ' +
        'To enable board access, set AZURE_DEVOPS_ALLOWED_TEAM_BOARDS to a comma-separated list of team names.',
    );
  }

  // If teamId is provided, validate it
  if (teamId) {
    const teamName = await getTeamNameById(connection, projectId, teamId);

    if (!teamName) {
      throw new AzureDevOpsValidationError(
        `Cannot verify team board access. Team '${teamId}' not found in project '${projectId}'. ` +
          'Ensure the team exists and is configured in AZURE_DEVOPS_ALLOWED_TEAM_BOARDS.',
      );
    }

    if (!isTeamAllowed(allowedTeams, teamName)) {
      throw new AzureDevOpsValidationError(
        `Access denied. Team board '${teamName}' is not in the allowed list. ` +
          `Allowed teams: ${allowedTeams.join(', ')}. ` +
          `Please add '${teamName}' to AZURE_DEVOPS_ALLOWED_TEAM_BOARDS if you need access.`,
      );
    }
  }
  // Note: If no teamId is provided, we still allow the operation to proceed
  // The caller should specify a teamId for proper filtering, or we validate individual work items later
}

/**
 * Fetch and validate a work item
 * Fetches the work item and validates it belongs to an allowed team
 */
export async function fetchAndValidateWorkItem(
  config: AzureDevOpsConfig,
  connection: WebApi,
  projectId: string,
  workItemId: number,
): Promise<WorkItem> {
  const witApi = await connection.getWorkItemTrackingApi();

  const workItem = await witApi.getWorkItem(
    workItemId,
    undefined,
    undefined,
    WorkItemExpand.All,
  );

  if (!workItem) {
    throw new AzureDevOpsValidationError(`Work item '${workItemId}' not found`);
  }

  // Validate the work item belongs to an allowed team
  await validateWorkItemTeamAccess(config, connection, projectId, workItem);

  return workItem;
}
