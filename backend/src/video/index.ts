import { config } from "../config.ts";
import { PUBLIC_DIR } from "../paths.ts";
import { LtxVideoProvider } from "./ltx.ts";
import { MockVideoProvider } from "./mock.ts";
import type { VideoProvider } from "./types.ts";

export const videoProvider: VideoProvider =
  config.VIDEO_PROVIDER === "ltx"
    ? new LtxVideoProvider(config.LTX_API_KEY)
    : new MockVideoProvider({
        videoUrl: config.MOCK_VIDEO_URL,
        delayMs: config.MOCK_VIDEO_DELAY_MS,
        publicDir: PUBLIC_DIR,
      });

/** Startup warnings so misconfiguration is visible before the demo. */
export function videoConfigWarnings(): string[] {
  if (videoProvider instanceof MockVideoProvider) {
    const problem = videoProvider.configProblem();
    return problem ? [`[video:mock] ${problem} Jobs will end with status "failed" for the video stage.`] : [];
  }
  return config.LTX_API_KEY ? [] : ["[video:ltx] LTX_API_KEY is not set: video jobs will fail."];
}
