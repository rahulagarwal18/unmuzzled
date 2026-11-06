import Svg, { Circle, Path, Rect } from "react-native-svg";

// Same hand-drawn set as the desktop interface.
const icons = {
  menu: <Path d="M4 7h16M4 12h16M4 17h10" />,
  compose: (
    <>
      <Path d="M12 4H6.5A2.5 2.5 0 0 0 4 6.5v11A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5V12" />
      <Path d="M18.4 3.6a1.9 1.9 0 0 1 2.7 2.7L13 14.4l-3.5.9.9-3.5 8-8.2Z" />
    </>
  ),
  sliders: (
    <>
      <Path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <Circle cx={15} cy={7} r={2} />
      <Circle cx={9} cy={17} r={2} />
    </>
  ),
  copy: (
    <>
      <Rect x={8.5} y={8.5} width={12} height={12} rx={2} />
      <Path d="M15.5 8.5V5.5a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3" />
    </>
  ),
  check: <Path d="m5 12.5 4.5 4.5L19 7.5" />,
  retry: (
    <>
      <Path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5" />
      <Path d="M4 4v4.5h4.5" />
    </>
  ),
  trash: <Path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.5h6.4a1.5 1.5 0 0 0 1.5-1.5l.8-12" />,
  arrowUp: <Path d="M12 19V5M6 11l6-6 6 6" />,
  stop: <Rect x={7} y={7} width={10} height={10} rx={1.5} fill="currentColor" stroke="none" />,
  x: <Path d="M6 6l12 12M18 6 6 18" />,
  chevron: <Path d="m9 6 6 6-6 6" />,
  download: <Path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" />,
  folder: <Path d="M3.5 7.5A2 2 0 0 1 5.5 5.5h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" />,
  pause: <Path d="M9 6v12M15 6v12" />,
  play: <Path d="M8 5.5v13l10.5-6.5Z" />,
  bulb: (
    <>
      <Path d="M9 18h6M10 21h4" />
      <Path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1.1 1.3 1.1 2.2h5c0-.9.5-1.7 1.1-2.2A6 6 0 0 0 12 3Z" />
    </>
  ),
  mark: (
    <>
      <Path d="M4 20V9a5 5 0 0 1 5-5h11v11a5 5 0 0 1-5 5H4Z" />
      <Path d="M9 15V11a2 2 0 0 1 2-2h4" />
    </>
  ),
};

export type IconName = keyof typeof icons;

export function Icon({ name, size = 20, color, strokeWidth = 1.6 }: {
  name: IconName;
  size?: number;
  color: string;
  strokeWidth?: number;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      color={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {icons[name]}
    </Svg>
  );
}
