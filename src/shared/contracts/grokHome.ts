type GrokHomeProfileKind = "native" | "legacy" | "custom";

export interface GrokHomeProfileSummary {
  id: string;
  kind: GrokHomeProfileKind;
  path: string;
  active: boolean;
  available: boolean;
}

export interface GrokHomeProfileStatus {
  activeId: string;
  profiles: GrokHomeProfileSummary[];
}

export interface GrokHomeProfileSwitchResult {
  changed: boolean;
  status: GrokHomeProfileStatus;
}
