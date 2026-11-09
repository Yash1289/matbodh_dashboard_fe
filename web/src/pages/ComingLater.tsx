import { Text } from "@mantine/core";

export function ComingLater({ section, phase = 2 }: { section: string; phase?: 2 | 3 }) {
  return <Text>{`${section} arrives in phase ${phase}`}</Text>;
}
