import { StyleSheet, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  LinearGradient as SvgGradient,
  Path,
  Rect,
  Stop,
} from 'react-native-svg';

export function SceneArt() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg height="100%" preserveAspectRatio="xMidYMid slice" viewBox="0 0 640 340" width="100%">
        <Defs>
          <SvgGradient id="kanSky" x1="0" x2="0" y1="0" y2="1">
            <Stop offset="0" stopColor="#2A1712" />
            <Stop offset="0.55" stopColor="#160E0C" />
            <Stop offset="1" stopColor="#0A0908" />
          </SvgGradient>
          <SvgGradient id="kanRidge" x1="0" x2="0" y1="0" y2="1">
            <Stop offset="0" stopColor="#201512" />
            <Stop offset="1" stopColor="#0A0908" />
          </SvgGradient>
        </Defs>
        <Rect fill="url(#kanSky)" height="340" width="640" />
        <Circle cx="472" cy="112" fill="#C94A34" opacity="0.82" r="62" />
        <Circle
          cx="472"
          cy="112"
          fill="none"
          opacity="0.42"
          r="82"
          stroke="#C7A467"
          strokeWidth="1"
        />
        <Circle
          cx="472"
          cy="112"
          fill="none"
          opacity="0.12"
          r="108"
          stroke="#F4EAD6"
          strokeWidth="1"
        />
        <Path
          d="M0 242 L92 184 L178 228 L286 128 L380 210 L470 172 L572 236 L640 206 L640 340 L0 340 Z"
          fill="url(#kanRidge)"
          opacity="0.9"
        />
        <Path
          d="M0 290 L110 246 L208 282 L314 244 L420 286 L540 248 L640 278 L640 340 L0 340 Z"
          fill="#080706"
        />
        <Path
          d="M0 310 L150 290 L260 306 L390 286 L520 308 L640 294 L640 340 L0 340 Z"
          fill="#050404"
        />
        <Path
          d="M0 270 C 100 260, 130 274, 220 266"
          fill="none"
          opacity="0.18"
          stroke="#F4EAD6"
          strokeWidth="1"
        />
        <Path
          d="M330 176 C 390 190, 430 210, 510 198"
          fill="none"
          opacity="0.12"
          stroke="#F4EAD6"
          strokeWidth="1"
        />
        <Path
          d="M542 24 L498 278"
          opacity="0.12"
          stroke="#F4EAD6"
          strokeWidth="1"
        />
        <Path
          d="M568 84 L526 298"
          opacity="0.08"
          stroke="#F4EAD6"
          strokeWidth="1"
        />
      </Svg>
    </View>
  );
}
