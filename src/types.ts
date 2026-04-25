export interface ModelMeta {
  // extensible — add properties here in the future
}

export interface ProviderConfig {
  baseUrl: string;
  apiKey: string;
  models: Record<string, ModelMeta>;
}

/** A provider + upstream model pair. Used for routing mappings and API responses. */
export interface ModelDef {
  provider: string;
  modelId: string;
}


export interface AppConfig {
  port: number;
  providers: Record<string, ProviderConfig>;
  mappings: Record<string, ModelDef>;
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
