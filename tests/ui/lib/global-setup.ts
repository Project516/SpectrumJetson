import { mkdirSync, writeFileSync } from "fs";

// Refuse to run against a robot that's connected, and make sure our build is the one answering.
export default async function globalSetup() {
  const base = process.env.PV_URL ?? "http://localhost:5800";
  let state: Response;
  try {
    state = await fetch(`${base}/api/spectrum/uiState`);
  } catch (e) {
    throw new Error(
      `Can't reach PhotonVision at ${base}. Open the tunnel first (tests/ui/run.sh does it), or set PV_URL.`
    );
  }
  if (!state.ok) {
    throw new Error(
      `${base}/api/spectrum/uiState answered ${state.status}: this PhotonVision build is older than photonvision-45.`
    );
  }
  // Every camera's running pipeline, so global-teardown can catch a test that leaves one moved.
  const cameras = (await state.json()).cameras as { nickname: string; currentPipelineIndex: number; pipelineNicknames: string[] }[];
  const start = cameras.map((c) => ({ camera: c.nickname, pipeline: c.pipelineNicknames[c.currentPipelineIndex] ?? String(c.currentPipelineIndex) }));
  mkdirSync(".state", { recursive: true });
  writeFileSync(".state/start-pipelines.json", JSON.stringify(start, null, 2));
  const rewind = await (await fetch(`${base}/api/rewind`)).json();
  // Every camera PhotonVision knows must be streaming. Tests like "Create on every camera" also
  // change the saved setup of an unplugged camera, and nothing can clean that up until it's back:
  // a run on 2026-10-01 with no cameras plugged in left test pipelines in three cameras' settings.
  const fps = new Map<string, number>((rewind.cameras ?? []).map((c: { camera: string; fps: number }) => [c.camera, c.fps]));
  const idle = cameras.map((c) => c.nickname).filter((n) => !((fps.get(n) ?? 0) > 0));
  if (idle.length && process.env.PV_UI_TEST_WITHOUT_ALL_CAMERAS !== "1") {
    throw new Error(
      `No frames from ${idle.join(", ")}. Plug every camera in first: the tests change every ` +
        "camera's pipelines, and can't put an unplugged camera's back. " +
        "(PV_UI_TEST_WITHOUT_ALL_CAMERAS=1 to run anyway.)"
    );
  }
  if (rewind.robotConnected && process.env.PV_UI_TEST_ON_ROBOT !== "1") {
    throw new Error(
      "The Jetson is connected to a robot. These tests switch pipelines and move camera settings; " +
        "run them on the bench, or set PV_UI_TEST_ON_ROBOT=1 if the robot is safe (disabled, on blocks)."
    );
  }
}
