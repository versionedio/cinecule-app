import { api } from "./apiClient";

export interface ConnectorInfo {
  connector_id: string;
  display_name: string;
  category?: string;
  auth_type?: string;
  enabled?: boolean;
  auth_schema?: { fields: { name: string; label: string; type: string; required?: boolean }[] };
}

export interface ConnectorSetting {
  group: string;
  name: string;
  enabled: boolean;
  configured?: boolean;
  updated_at?: string;
}

/** Catalog of connectors the platform offers (Slack, Twilio, S3, ...). */
export function listAvailableConnectors() {
  return api.get<{ connectors: ConnectorInfo[] }>(`/connectors`);
}

/** This tenant's saved connector credentials (never returns the secrets). */
export function listConfiguredConnectors() {
  return api.get<{ settings: ConnectorSetting[] }>(`/settings?group=connector`);
}

/** Save credentials for a connector. Extra fields depend on the connector's auth_schema. */
export function saveConnectorCredentials(
  connectorId: string,
  credentialFields: Record<string, string>,
  enabled = true
) {
  return api.put(`/settings`, {
    group: "connector",
    name: connectorId,
    enabled,
    ...credentialFields
  });
}

export function removeConnectorCredentials(connectorId: string) {
  return api.del(`/settings?group=connector&name=${encodeURIComponent(connectorId)}`);
}
