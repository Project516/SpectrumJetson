import { readFileSync } from "fs";

// Which cameras are streaming: frames processed (photonvision-58's framesProcessed in
// /api/spectrum/uiState) between two reads 1.5 s apart, above 15 a second. global-setup records it in
// .state/cameras.json; tests read it with streamingCameras().

export interface CameraInventory {
  streaming: string[];
  absent: string[];
}

type UiCamera = { nickname: string; framesProcessed?: number };

export async function measureCameras(base: string): Promise<CameraInventory> {
  const read = async () =>
    ((await (await fetch(`${base}/api/spectrum/uiState`)).json()).cameras as UiCamera[]);
  const first = await read();
  if (first.some((c) => c.framesProcessed === undefined)) {
    throw new Error("/api/spectrum/uiState has no framesProcessed: this PhotonVision build is older than photonvision-58.");
  }
  await new Promise((r) => setTimeout(r, 1500));
  const second = await read();
  const streaming: string[] = [];
  const absent: string[] = [];
  for (const c of second) {
    const before = first.find((f) => f.nickname === c.nickname)?.framesProcessed ?? 0;
    // More than 15 fps: a camera that's gone still yields ~10 empty results a second (seen
    // 2026-10-01 with BottomLeft unplugged); a streaming one does at least 30, even idle.
    const fps = ((c.framesProcessed ?? 0) - before) / 1.5;
    (fps > 15 ? streaming : absent).push(c.nickname);
  }
  return { streaming, absent };
}

export function cameraInventory(): CameraInventory {
  return JSON.parse(readFileSync(".state/cameras.json", "utf8"));
}

/** Why a test that touches every camera has to skip, or "" if every camera is streaming. */
export function notAllStreaming(): string {
  const { absent } = cameraInventory();
  return absent.length
    ? `touches every camera, and ${absent.join(", ")} ${absent.length > 1 ? "aren't" : "isn't"} streaming: ` +
        "PhotonVision changes an unplugged camera's saved setup too, and the test can't put it back"
    : "";
}
