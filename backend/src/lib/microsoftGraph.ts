import { ConfidentialClientApplication } from '@azure/msal-node';

const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';

export interface MicrosoftUserProfile {
  id: string;
  displayName: string;
  mail: string | null;
  userPrincipalName: string;
  jobTitle: string | null;
  department: string | null;
}

export interface MicrosoftTokenResponse {
  accessToken: string;
  idToken?: string;
  expiresOn: Date;
}

function createMsalClient(tenantId: string, clientId: string, clientSecret: string) {
  return new ConfidentialClientApplication({
    auth: {
      clientId,
      clientSecret,
      authority: `https://login.microsoftonline.com/${tenantId}`,
    },
  });
}

export async function getClientCredentialsToken(tenantId: string, clientId: string, clientSecret: string): Promise<string> {
  const msalClient = createMsalClient(tenantId, clientId, clientSecret);
  const result = await msalClient.acquireTokenByClientCredential({
    scopes: ['https://graph.microsoft.com/.default'],
  });
  if (!result?.accessToken) throw new Error('Failed to acquire client credentials token');
  return result.accessToken;
}

export async function validateConnection(
  tenantId: string,
  clientId: string,
  clientSecret: string
): Promise<{ success: boolean; message: string }> {
  try {
    const msalClient = createMsalClient(tenantId, clientId, clientSecret);
    const result = await msalClient.acquireTokenByClientCredential({
      scopes: ['https://graph.microsoft.com/.default'],
    });

    if (!result?.accessToken) {
      return { success: false, message: 'Failed to acquire access token from Azure AD' };
    }

    const response = await fetch(`${GRAPH_API_BASE}/organization`, {
      headers: { Authorization: `Bearer ${result.accessToken}` },
    });

    if (!response.ok) {
      return { success: false, message: `Microsoft Graph API returned ${response.status}: ${response.statusText}` };
    }

    return { success: true, message: 'Successfully connected to Microsoft Teams / Azure AD' };
  } catch (error: any) {
    return { success: false, message: error.message || 'Failed to connect to Microsoft Azure AD' };
  }
}

export function buildAuthorizationUrl(
  tenantId: string,
  clientId: string,
  redirectUri: string,
  state: string
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: 'openid profile email User.Read',
    state,
  });

  return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params.toString()}`;
}

export async function exchangeCodeForTokens(
  tenantId: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  code: string
): Promise<MicrosoftTokenResponse> {
  const msalClient = createMsalClient(tenantId, clientId, clientSecret);
  const result = await msalClient.acquireTokenByCode({
    code,
    scopes: ['openid', 'profile', 'email', 'User.Read'],
    redirectUri,
  });

  return {
    accessToken: result.accessToken,
    idToken: result.idToken,
    expiresOn: result.expiresOn || new Date(Date.now() + 3600 * 1000),
  };
}

export async function getUserProfile(accessToken: string): Promise<MicrosoftUserProfile> {
  const response = await fetch(`${GRAPH_API_BASE}/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch user profile: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return {
    id: data.id,
    displayName: data.displayName,
    mail: data.mail,
    userPrincipalName: data.userPrincipalName,
    jobTitle: data.jobTitle,
    department: data.department,
  };
}

export async function getOrganizationUsers(accessToken: string): Promise<MicrosoftUserProfile[]> {
  const response = await fetch(`${GRAPH_API_BASE}/users?$select=id,displayName,mail,userPrincipalName,jobTitle,department&$top=999`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch users: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return (data.value || []).map((u: any) => ({
    id: u.id,
    displayName: u.displayName,
    mail: u.mail,
    userPrincipalName: u.userPrincipalName,
    jobTitle: u.jobTitle,
    department: u.department,
  }));
}
