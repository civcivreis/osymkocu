import { useEventListener } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect } from 'react';
import { View } from 'react-native';

export function LessonVideo({
  uri,
  paused,
  seekMs,
  onTimeMs,
  onEnded,
}: {
  uri: string;
  paused: boolean;
  seekMs: number | null;
  onTimeMs: (ms: number) => void;
  onEnded: () => void;
}) {
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = false;
    instance.timeUpdateEventInterval = 0.25;
  });

  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    onTimeMs((currentTime ?? 0) * 1000);
  });
  useEventListener(player, 'playToEnd', onEnded);

  useEffect(() => {
    if (paused) player.pause();
    else void player.play();
  }, [paused, player]);

  useEffect(() => {
    if (seekMs == null) return;
    player.currentTime = seekMs / 1000;
  }, [player, seekMs]);

  return (
    <View
      style={{
        width: '100%',
        aspectRatio: 16 / 9,
        borderRadius: 16,
        overflow: 'hidden',
        backgroundColor: '#0F1C2E',
      }}>
      <VideoView
        style={{ width: '100%', height: '100%' }}
        player={player}
        nativeControls
        contentFit="contain"
        fullscreenOptions={{ enable: true }}
      />
    </View>
  );
}
