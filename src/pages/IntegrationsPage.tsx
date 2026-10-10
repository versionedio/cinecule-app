import { useEffect, useState } from "react";
import {
  ConnectorInfo, ConnectorSetting, listAvailableConnectors,
  listConfiguredConnectors, removeConnectorCredentials, saveConnectorCredentials
} from "@/services/settingsService";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";

export default function IntegrationsPage() {
  const [available, setAvailable] = useState<ConnectorInfo[]>([]);
  const [configured, setConfigured] = useState<ConnectorSetting[]>([]);
  const [editing, setEditing] = useState<ConnectorInfo | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = async () => {
    try {
      const [avail, conf] = await Promise.all([listAvailableConnectors(), listConfiguredConnectors()]);
      setAvailable(avail.connectors ?? []);
      setConfigured(conf.settings ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load connectors.");
    }
  };

  useEffect(() => {
    load();
  }, []);

  const statusOf = (id: string) => configured.find((c) => c.name === id);

  const save = async () => {
    if (!editing) return;
    setError("");
    setNotice("");
    try {
      await saveConnectorCredentials(editing.connector_id, fields);
      setNotice(`${editing.display_name} connected.`);
      setEditing(null);
      setFields({});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    }
  };

  const disconnect = async (id: string) => {
    setError("");
    setNotice("");
    try {
      await removeConnectorCredentials(id);
      setNotice("Disconnected.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Disconnect failed.");
    }
  };

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold">Integrations</h1>
      <p className="mb-6 mt-1 text-muted">
        Connect the services your pipeline uses — keys are stored encrypted and never shown again.
      </p>

      {notice && <Alert severity="success" className="mb-4">{notice}</Alert>}
      {error && <Alert severity="error" className="mb-4">{error}</Alert>}
      {available.length === 0 && !error && <p className="text-muted">No connectors are enabled for this org yet.</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {available.map((c, i) => {
          const s = statusOf(c.connector_id);
          return (
            <Card
              key={c.connector_id}
              className="motion-safe:animate-fade-up transition-colors hover:border-primary/50"
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <CardContent>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <p className="font-display font-semibold">{c.display_name}</p>
                  {s?.configured ? (
                    <Badge color="#3f9d5f">connected</Badge>
                  ) : (
                    <Badge>not connected</Badge>
                  )}
                </div>
                <p className="mb-4 text-sm text-muted">{c.category ?? "connector"}</p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      setEditing(c);
                      setFields({});
                    }}
                  >
                    {s?.configured ? "Update keys" : "Connect"}
                  </Button>
                  {s?.configured && (
                    <Button size="sm" variant="destructive" onClick={() => disconnect(c.connector_id)}>
                      Disconnect
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect {editing?.display_name}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            {(editing?.auth_schema?.fields ?? []).map((f) => (
              <Field key={f.name} label={f.label}>
                <Input
                  type={f.type === "password" ? "password" : "text"}
                  required={f.required}
                  value={fields[f.name] ?? ""}
                  onChange={(e) => setFields((prev) => ({ ...prev, [f.name]: e.target.value }))}
                />
              </Field>
            ))}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={save}>Save connection</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
