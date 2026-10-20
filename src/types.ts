export interface CoordinateItemInput {
  coordinate: string;
  style?: "standard" | "tactical";
  id?: string;
  label?: string;
  source?: string;
}

export interface ParsedCoordinate {
  x: number;
  y: number;
  plane: number;
}

export interface CoordinateItem extends CoordinateItemInput {
  id: string;
  parsed: ParsedCoordinate;
}

export interface TileCoordinate {
  tileX: number;
  tileY: number;
  pixelX: number;
  pixelY: number;
}

export interface RenderSuccess {
  status: "success";
  id: string;
  label?: string;
  source?: string;
  coordinate: string;
  resolved: TileCoordinate;
  imagePath?: string;
  imageName?: string;
  imageUrl?: string;
}

export interface RenderFailure {
  status: "failure";
  id: string;
  label?: string;
  source?: string;
  coordinate: string;
  error: string;
}

export type RenderResult = RenderSuccess | RenderFailure;

export interface RenderManifest {
  tileBaseUrl: string;
  generatedAt: string;
  renderCount: number;
  failedCount: number;
  items: RenderResult[];
}

export interface RenderOptions {
  outputDir: string;
  tileVersion?: string;
  style?: "standard" | "tactical";
  cropSize?: number;
  markerRadius?: number;
  tileBaseUrl?: string;
  fetchImpl?: typeof fetch;
  debug?: boolean;
  logger?: (message: string) => void;
}

export interface RenderServiceResponse {
  renderCount: number;
  failedCount: number;
  items: RenderResult[];
}
