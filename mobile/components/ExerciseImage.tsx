import { useEffect, useState } from 'react';
import { View, Text, Image, StyleSheet, ImageStyle, StyleProp } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SkeletonBlock } from './Skeleton';
import { colors } from '@/lib/colors';

/**
 * Exercise demo image with three visual states (loading / loaded / error)
 * and a guaranteed `accessibilityLabel`. The bare `<Image>` we used to
 * render gave VoiceOver no description at all and showed a blank rect
 * while the bytes were in flight — the empty-state UX the a11y audit
 * (docs/a11y-audit-2026-04.md) flagged.
 *
 * `alt` is required. Backend hydrator already substitutes a default
 * ("{exercise.name} demonstration") when no per-image alt_text is
 * stored, so callers shouldn't have to invent one.
 *
 * Layout: `style` is applied to the wrapping View, which owns dimensions
 * + borderRadius + margins. The inner Image is a normal (non-absolute)
 * child sized 100% × 100% so iOS `overflow:'hidden'` actually clips the
 * rounded corners — RN's iOS implementation skips clipping
 * absolutely-positioned children, which is why an earlier draft showed
 * square corners on rounded thumbnails. The skeleton is absolute so it
 * sits *over* the Image during the loading state.
 */
interface Props {
  uri?: string | null;
  alt: string;
  style?: StyleProp<ImageStyle>;
  resizeMode?: 'cover' | 'contain' | 'center' | 'stretch';
}

export function ExerciseImage({ uri, alt, style, resizeMode = 'cover' }: Props) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>(uri ? 'loading' : 'error');

  // Reset on uri change. Without this, a later prop swap (e.g. routine
  // reload after the user pastes a fresh image URL into the same row)
  // could leave the component stuck in `'error'` or `'loaded'` from the
  // previous URI and never fire onLoad for the new one.
  useEffect(() => {
    setStatus(uri ? 'loading' : 'error');
  }, [uri]);

  if (!uri || status === 'error') {
    return (
      <View
        style={[styles.fallback, style as any]}
        accessible
        accessibilityRole="image"
        accessibilityLabel={`${alt} (image unavailable)`}
      >
        <Ionicons name="image-outline" size={24} color={colors.textFaint} />
        <Text style={styles.fallbackText}>Image unavailable</Text>
      </View>
    );
  }

  return (
    <View style={[styles.wrap, style as any]}>
      <Image
        source={{ uri }}
        style={[styles.fill, status === 'loading' && styles.hidden]}
        resizeMode={resizeMode}
        onLoad={() => setStatus('loaded')}
        onError={() => setStatus('error')}
        accessible
        accessibilityRole="image"
        accessibilityLabel={alt}
      />
      {status === 'loading' && (
        <SkeletonBlock style={styles.overlay as any} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // overflow:hidden + position:relative so:
  // (a) the inner Image (a non-absolute 100% child) clips to the
  //     caller's borderRadius on iOS and Android, and
  // (b) the absolutely-positioned skeleton overlay anchors to this View
  //     rather than escaping to the nearest positioned ancestor on web.
  wrap: { overflow: 'hidden', position: 'relative' },
  fill: { width: '100%', height: '100%' },
  overlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
  },
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f0f0f0',
    borderRadius: 6,
    gap: 4,
    padding: 8,
  },
  fallbackText: {
    fontSize: 11,
    color: colors.textMuted,
    textAlign: 'center',
  },
  hidden: { opacity: 0 },
});
