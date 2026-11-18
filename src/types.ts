export type OcrLanguage = "eng+fas" | "eng" | "fas";

export type HighlightSensitivity = "high" | "medium" | "low";

export interface CapturedPage {
  id: string;
  dataUrl: string;
  name: string;
  source: "camera" | "gallery" | "sample";
}
