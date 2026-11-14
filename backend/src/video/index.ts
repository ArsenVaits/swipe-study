import { config } from "../config.ts";
import { PUBLIC_DIR } from "../paths.ts";
import { HyperframesVideoProvider } from "./hyperframes/provider.ts";
import { LtxVideoProvider } from "./ltx.ts";
import { MockVideoProvider } from "./mock.ts";
import type { VideoProvider } from "./types.ts";

function createProvider(): VideoProvider {
  switch (config.VIDEO_PROVIDER) {
    case "ltx":
      return new LtxVideoProvider(config.LTX_API_KEY);
    case "hyperframes":
      return new HyperframesVideoProvider();
    default:
      return new MockVideoProvider({ videoUrl: config.MOCK_VIDEO_URL, delayMs: config.MOCK_VIDEO_DELAY_MS, publicDir: PUBLIC_DIR });
  }
}

export const videoProvider: VideoProvider = createProvider();

/** Startup warnings so misconfiguration is visible before the demo. */
export function videoConfigWarnings(): string[] {
  if (videoProvider instanceof MockVideoProvider) {
    const problem = videoProvider.configProblem();
    return problem ? [`[video:mock] ${problem} Jobs will end with status "failed" for the video stage.`] : [];
  }
  if (videoProvider instanceof HyperframesVideoProvider) {
    return videoProvider.configProblems().map((p) => `[video:hyperframes] ${p}`);
  }
  return config.LTX_API_KEY ? [] : ["[video:ltx] LTX_API_KEY is not set: video jobs will fail."];
}
