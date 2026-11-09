import { Group, SegmentedControl, Text } from "@mantine/core";
import { useState } from "react";
import type { TransitionMatrixResult } from "../../api/types";
import { formatPercent } from "../../cells/format";
import { tokens } from "../../theme";

export interface TransitionMatrixBodyProps {
  data: TransitionMatrixResult;
  lens?: "origin_share" | "destination_share" | "joint_share";
}

const BORDER = "1px solid var(--mb-border)";
const HEADER_CELL = {
  background: "var(--mb-header-bg)",
  borderBottom: BORDER,
  borderRight: BORDER,
  padding: "10px 12px",
  textAlign: "left" as const,
  verticalAlign: "middle" as const,
  fontWeight: 600,
  fontSize: tokens.font.tableHeader,
  color: "var(--mb-text)",
};

const normalizeLabel = (s: string) => s.replace(/\s*\(\d{4}\)/g, "").trim().toLowerCase();

export function TransitionMatrixBody({ data, lens }: TransitionMatrixBodyProps) {
  const [internalLens, setInternalLens] = useState<"origin_share" | "destination_share" | "joint_share">(
    lens ?? "origin_share"
  );
  const activeLens = lens ?? internalLens;

  const isNonVoter = (s: string) => /(did not vote|do not remember)/i.test(s);

  return (
    <div>
      <Group justify="space-between" mb="xs">
        <Text size="xs" c="dimmed">
          {activeLens === "origin_share"
            ? "Flow Out (Where origin voters transitioned to)"
            : activeLens === "destination_share"
            ? "Flow In (Where destination voters came from)"
            : "Joint Share of Electorate"}
        </Text>
        <SegmentedControl
          size="xs"
          value={activeLens}
          onChange={(val) => setInternalLens(val as any)}
          data={[
            { label: "Flow Out (Origin %)", value: "origin_share" },
            { label: "Flow In (Destination %)", value: "destination_share" },
            { label: "Joint %", value: "joint_share" },
          ]}
        />
      </Group>

      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "separate", borderSpacing: 0, width: "100%" }}>
          <thead>
            <tr>
              <th scope="col" style={{ ...HEADER_CELL, width: 140 }}>
                Origin \ Destination
              </th>
              {data.destinations.map((dest) => (
                <th key={dest} scope="col" style={{ ...HEADER_CELL, textAlign: "right" }}>
                  {dest}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.origins.map((origin, originIdx) => (
              <tr key={origin}>
                <th scope="row" style={HEADER_CELL}>
                  {origin}
                </th>
                {data.destinations.map((dest, destIdx) => {
                  const isExactMatch = origin === dest;
                  const isIndexDiagonalMatch =
                    originIdx === destIdx && normalizeLabel(origin) === normalizeLabel(dest);
                  const isDiagonal = isExactMatch || isIndexDiagonalMatch;

                  const nonVoterCell = isNonVoter(origin) || isNonVoter(dest);
                  const cell = data.matrix[origin]?.[dest];
                  const rawVal = cell ? cell[activeLens] : null;
                  const text = rawVal !== null && rawVal !== undefined ? formatPercent(rawVal) : "—";

                  const borderWidth = isDiagonal ? "2px" : "1px";
                  const borderStyle = isDiagonal ? "solid" : nonVoterCell ? "dashed" : "solid";
                  const borderColor = isDiagonal ? "var(--mb-primary)" : "var(--mb-border)";
                  const bg = isDiagonal ? "var(--mb-primary-soft)" : undefined;

                  return (
                    <td
                      key={dest}
                      data-testid={isDiagonal ? "diagonal-cell" : undefined}
                      data-diagonal={isDiagonal ? "true" : undefined}
                      style={{
                        padding: "10px 12px",
                        textAlign: "right",
                        fontVariantNumeric: "tabular-nums",
                        fontWeight: isDiagonal ? 600 : 400,
                        backgroundColor: bg,
                        border: `${borderWidth} ${borderStyle} ${borderColor}`,
                        borderWidth,
                        borderStyle,
                        borderColor,
                        color: "var(--mb-text)",
                        fontSize: tokens.font.composite,
                      }}
                    >
                      {text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
