import { mobileAccess } from "../../fork/cloudflare-access/mobileAccess"; // fork: cloudflare-access
import { useReleasingSharedObjectWithLifecycle } from "expo";
import { createAudioPlayer } from "expo-audio";
import { disposeAudioPlayer } from "../../lib/audioSession";

export function usePlaybackAudioPlayer(uri: string | null) {
  const token = uri ? mobileAccess.peekToken(uri) : null;
  // Keep the native ref alive until any pending activation and release finish.
  return useReleasingSharedObjectWithLifecycle(
    {
      factory: () =>
        createAudioPlayer(uri && token ? { uri, headers: { "Cf-Access-Token": token } } : uri, {
          updateInterval: 500,
        }),
      release: disposeAudioPlayer,
    },
    [uri, token],
  );
}
