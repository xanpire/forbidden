import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  Droplets,
  Moon,
  Sun,
  ThermometerSun,
  Wind,
} from 'lucide-react-native';

import type { WeatherCondition } from '@/lib/rpg/types';

/** The weather as a small icon: the Story header, the map. Clear skies show the sun or the moon. */
export function WeatherIcon({
  condition,
  night,
  color,
  size = 18,
}: {
  condition: WeatherCondition;
  night: boolean;
  color: string;
  size?: number;
}) {
  const props = { color, size, strokeWidth: 2 };

  switch (condition) {
    case 'clear':
      return night ? <Moon {...props} /> : <Sun {...props} />;
    case 'cloudy':
      return <Cloud {...props} />;
    case 'drizzle':
      return <CloudDrizzle {...props} />;
    case 'rain':
    case 'downpour':
      return <CloudRain {...props} />;
    case 'storm':
      return <CloudLightning {...props} />;
    case 'fog':
      return <CloudFog {...props} />;
    case 'snow':
    case 'blizzard':
    case 'sleet':
      return <CloudSnow {...props} />;
    case 'wind':
    case 'sandstorm':
      return <Wind {...props} />;
    case 'heat':
      return night ? <Moon {...props} /> : <ThermometerSun {...props} />;
    case 'humid':
      return <Droplets {...props} />;
    default:
      return night ? <Moon {...props} /> : <Sun {...props} />;
  }
}
