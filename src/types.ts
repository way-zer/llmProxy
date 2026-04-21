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
