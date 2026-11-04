export type Field = { key: string; label: string; type: string; required: boolean };
export type Tool = {
  id: string;
  name: string;
  group: string;
  icon: string;
  description: string;
  unit: string;
  fields: Field[];
  utility?: string;
  integration?: string;
};
export type Item = {
  id: string;
  module: string;
  title: string;
  status: string;
  data: Record<string, string | boolean>;
  archived: boolean;
  version: number;
  created: string;
  updated: string;
  votes: number;
};
export type User = { id: string; email: string; name: string };
export type Check = {
  id: string;
  record_id: string;
  created: string;
  result: {
    ok: boolean;
    status?: number;
    ms?: number;
    error?: string;
    changed?: boolean;
    transition?: 'outage' | 'recovery';
    incident?: { id: string; opened: string; closed?: string };
    certificateExpires?: string | null;
    registrationExpires?: string | null;
    diff?: { before: string; after: string };
    links?: { url: string; status?: number; error?: string; sources?: string[] }[];
  };
};
