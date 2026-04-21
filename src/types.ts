export interface ProviderConfig {
  baseUrl: string;
  apiKey: string;
}

/** A provider + upstream model pair. Used for both model catalog and routing mappings. */
export interface ModelDef {
  provider: string;
  modelId: string;
}


export interface AppConfig {
  port: number;
  providers: Record<string, ProviderConfig>;
  models: ModelDef[];
  mappings: Record<string, ModelDef>;
}

export interface ChatCompletionRequest {
  model: string;
  messages: Array<{
    role: "system" | "user" | "assistant" | "function" | "tool";
    content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
    name?: string;
    tool_calls?: unknown[];
    tool_call_id?: string;
  }>;
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string | string[];
  tools?: unknown[];
  tool_choice?: string | { type: string; function: { name: string } };
  response_format?: { type: string };
  [key: string]: unknown;
}

export interface UpstreamModel {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
}

export interface UpstreamModelsResponse {
  object: string;
  data: UpstreamModel[];
}
