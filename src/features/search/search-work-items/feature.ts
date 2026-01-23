import { WebApi } from 'azure-devops-node-api';
import axios from 'axios';
import { DefaultAzureCredential, AzureCliCredential } from '@azure/identity';
import {
  AzureDevOpsError,
  AzureDevOpsResourceNotFoundError,
  AzureDevOpsValidationError,
  AzureDevOpsPermissionError,
} from '../../../shared/errors';
import {
  SearchWorkItemsOptions,
  WorkItemSearchRequest,
  WorkItemSearchResponse,
} from '../types';

/**
 * Search for work items in Azure DevOps projects
 *
 * @param connection The Azure DevOps WebApi connection
 * @param options Parameters for searching work items
 * @returns Search results with work item details and highlights
 */
export async function searchWorkItems(
  connection: WebApi,
  options: SearchWorkItemsOptions,
): Promise<WorkItemSearchResponse> {
  try {
    // Prepare the search request
    const searchRequest: WorkItemSearchRequest = {
      searchText: options.searchText,
      $skip: options.skip,
      $top: options.top,
      filters: {
        ...(options.projectId
          ? { 'System.TeamProject': [options.projectId] }
          : {}),
        ...options.filters,
      },
      includeFacets: options.includeFacets,
      $orderBy: options.orderBy,
    };

    // Get the authorization header from the connection
    const authHeader = await getAuthorizationHeader();

    // Extract organization and project from the connection URL
    const { organization, project, isOnPremise } = extractOrgAndProject(
      connection,
      options.projectId,
    );

    // On-premise TFS may not support the search API
    if (isOnPremise) {
      throw new AzureDevOpsValidationError(
        'Work item search is not supported for on-premise TFS/Azure DevOps Server. ' +
          'Please use list_work_items with WIQL queries instead.',
      );
    }

    // Make the search API request
    // If projectId is provided, include it in the URL, otherwise perform organization-wide search
    const searchUrl = options.projectId
      ? `https://almsearch.dev.azure.com/${organization}/${project}/_apis/search/workitemsearchresults?api-version=7.1`
      : `https://almsearch.dev.azure.com/${organization}/_apis/search/workitemsearchresults?api-version=7.1`;

    const searchResponse = await axios.post<WorkItemSearchResponse>(
      searchUrl,
      searchRequest,
      {
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
      },
    );

    return searchResponse.data;
  } catch (error) {
    // If it's already an AzureDevOpsError, rethrow it
    if (error instanceof AzureDevOpsError) {
      throw error;
    }

    // Handle axios errors
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const message = error.response?.data?.message || error.message;

      if (status === 404) {
        throw new AzureDevOpsResourceNotFoundError(
          `Resource not found: ${message}`,
        );
      } else if (status === 400) {
        throw new AzureDevOpsValidationError(
          `Invalid request: ${message}`,
          error.response?.data,
        );
      } else if (status === 401 || status === 403) {
        throw new AzureDevOpsPermissionError(`Permission denied: ${message}`);
      } else {
        // For other axios errors, wrap in a generic AzureDevOpsError
        throw new AzureDevOpsError(`Azure DevOps API error: ${message}`);
      }
      // This code is unreachable but TypeScript doesn't know that
    }

    // Otherwise, wrap it in a generic error
    throw new AzureDevOpsError(
      `Failed to search work items: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Extract organization and project from the connection URL
 *
 * @param connection The Azure DevOps WebApi connection
 * @param projectId The project ID or name (optional)
 * @returns The organization, project, and whether it's on-premise
 */
function extractOrgAndProject(
  connection: WebApi,
  projectId?: string,
): { organization: string; project: string; isOnPremise: boolean } {
  // Extract organization from the connection URL
  // Supports both dev.azure.com/{org} and on-premise TFS {server}/{collection}
  const url = connection.serverUrl;

  // Try dev.azure.com format first
  let match = url.match(/https?:\/\/dev\.azure\.com\/([^/]+)/);
  if (match) {
    return {
      organization: match[1],
      project: projectId || '',
      isOnPremise: false,
    };
  }

  // Try on-premise TFS format: https://{server}/{collection}
  match = url.match(/https?:\/\/[^/]+\/([^/?#]+)/);
  const organization = match ? match[1] : '';

  if (!organization) {
    throw new AzureDevOpsValidationError(
      'Could not extract organization from connection URL',
    );
  }

  return {
    organization,
    project: projectId || '',
    isOnPremise: true,
  };
}

/**
 * Get the authorization header from the connection
 *
 * @returns The authorization header
 */
async function getAuthorizationHeader(): Promise<string> {
  try {
    // For PAT authentication, we can construct the header directly
    if (
      process.env.AZURE_DEVOPS_AUTH_METHOD?.toLowerCase() === 'pat' &&
      process.env.AZURE_DEVOPS_PAT
    ) {
      // For PAT auth, we can construct the Basic auth header directly
      const token = process.env.AZURE_DEVOPS_PAT;
      const base64Token = Buffer.from(`:${token}`).toString('base64');
      return `Basic ${base64Token}`;
    }

    // For Azure Identity / Azure CLI auth, we need to get a token
    // using the Azure DevOps resource ID
    // Choose the appropriate credential based on auth method
    const credential =
      process.env.AZURE_DEVOPS_AUTH_METHOD?.toLowerCase() === 'azure-cli'
        ? new AzureCliCredential()
        : new DefaultAzureCredential();

    // Azure DevOps resource ID for token acquisition
    const AZURE_DEVOPS_RESOURCE_ID = '499b84ac-1321-427f-aa17-267ca6975798';

    // Get token for Azure DevOps
    const token = await credential.getToken(
      `${AZURE_DEVOPS_RESOURCE_ID}/.default`,
    );

    if (!token || !token.token) {
      throw new Error('Failed to acquire token for Azure DevOps');
    }

    return `Bearer ${token.token}`;
  } catch (error) {
    throw new AzureDevOpsValidationError(
      `Failed to get authorization header: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
