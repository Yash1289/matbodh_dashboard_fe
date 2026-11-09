import {
  Badge,
  Button,
  CloseButton,
  Drawer,
  Group,
  Paper,
  Progress,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useMemo, useState } from "react";
import { formatPercent } from "../cells/format";
import { tokens } from "../theme";

export interface SeatItem {
  ac_num?: number;
  pc_num?: number;
  name: string;
  winner: string;
  margin_pp: number | null;
  flip?: string;
  status?: string;
  district?: string;
  zone?: string;
}

export interface DemographicDriver {
  label: string;
  share: number;
}

export interface SeatCohort {
  title: string;
  subtitle?: string;
  description?: string;
  totalSeats?: number;
  avgMarginPp?: number | null;
  voteShare?: number | null;
  demographicDrivers?: DemographicDriver[];
  seats: SeatItem[];
}

export interface InvestigationDrawerProps {
  opened: boolean;
  onClose: () => void;
  cohort: SeatCohort | null;
}

export function InvestigationDrawer({ opened, onClose, cohort }: InvestigationDrawerProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredSeats = useMemo(() => {
    if (!cohort?.seats) return [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return cohort.seats;

    return cohort.seats.filter((seat) => {
      const nameMatch = (seat.name || "").toLowerCase().includes(q);
      const acMatch = seat.ac_num !== undefined && String(seat.ac_num).includes(q);
      const pcMatch = seat.pc_num !== undefined && String(seat.pc_num).includes(q);
      const winnerMatch = (seat.winner || "").toLowerCase().includes(q);
      const districtMatch = seat.district ? seat.district.toLowerCase().includes(q) : false;
      const zoneMatch = seat.zone ? seat.zone.toLowerCase().includes(q) : false;
      return nameMatch || acMatch || pcMatch || winnerMatch || districtMatch || zoneMatch;
    });
  }, [cohort?.seats, searchQuery]);

  const handleCopySeats = async () => {
    if (!cohort || !cohort.seats.length) return;
    const lines = cohort.seats
      .map((s) => {
        const num = s.ac_num !== undefined ? `#${s.ac_num} ` : s.pc_num !== undefined ? `#${s.pc_num} ` : "";
        const marginStr =
          s.margin_pp !== null && s.margin_pp !== undefined
            ? `${s.margin_pp > 0 ? "+" : ""}${s.margin_pp.toFixed(1)} pp`
            : "—";
        const flipStr = s.flip ?? s.status ? ` [${s.flip ?? s.status}]` : "";
        return `${num}${s.name} (${s.winner}, ${marginStr})${flipStr}`;
      })
      .join("\n");

    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(lines);
    }
  };

  const handleExportCsv = () => {
    if (!cohort || !cohort.seats.length) return;
    const headers = ["AC/PC No", "Seat Name", "Winner", "Margin (pp)", "Flip Status", "District", "Zone"];
    const rows = cohort.seats.map((s) => [
      s.ac_num ?? s.pc_num ?? "",
      `"${(s.name || "").replace(/"/g, '""')}"`,
      `"${(s.winner || "").replace(/"/g, '""')}"`,
      s.margin_pp !== null && s.margin_pp !== undefined ? s.margin_pp : "",
      `"${(s.flip ?? s.status ?? "").replace(/"/g, '""')}"`,
      `"${(s.district || "").replace(/"/g, '""')}"`,
      `"${(s.zone || "").replace(/"/g, '""')}"`,
    ]);

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });

    if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      const filename = `${cohort.title.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_seats.csv`;
      link.setAttribute("download", filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      if (typeof URL.revokeObjectURL === "function") {
        URL.revokeObjectURL(url);
      }
    }
  };

  const totalSeats = cohort ? cohort.totalSeats ?? cohort.seats.length : 0;
  const avgMarginText =
    cohort?.avgMarginPp !== undefined && cohort.avgMarginPp !== null
      ? `${cohort.avgMarginPp > 0 ? "+" : ""}${cohort.avgMarginPp.toFixed(1)} pp`
      : "—";
  const voteShareText =
    cohort?.voteShare !== undefined && cohort.voteShare !== null
      ? formatPercent(cohort.voteShare)
      : "—";

  return (
    <Drawer
      position="right"
      size={540}
      opened={opened}
      onClose={onClose}
      withCloseButton={false}
      aria-label="Seat Cohort Investigation"
      overlayProps={{ backgroundOpacity: 0.15, blur: 3 }}
      transitionProps={{ duration: 0 }}
      styles={{
        content: {
          display: "flex",
          flexDirection: "column",
        },
        body: {
          flex: 1,
          overflowY: "auto",
          padding: "20px 24px",
        },
      }}
    >
      {!cohort ? (
        <Stack align="center" justify="center" py="xl">
          <Text size="sm" c="dimmed">
            No cohort selected
          </Text>
          <Button variant="default" size="xs" onClick={onClose} aria-label="Close drawer">
            Close
          </Button>
        </Stack>
      ) : (
        <Stack gap="lg">
          {/* Header */}
          <Group justify="space-between" align="flex-start" wrap="nowrap">
            <div style={{ flex: 1, minWidth: 0 }}>
              <Title
                order={4}
                style={{
                  fontSize: tokens.font.cardTitle,
                  color: "var(--mb-text)",
                  lineHeight: 1.3,
                }}
              >
                Investigating: {cohort.title}
              </Title>
              {(cohort.subtitle ?? cohort.description) && (
                <Text size="xs" c="dimmed" mt={4} style={{ lineHeight: 1.4 }}>
                  {cohort.subtitle ?? cohort.description}
                </Text>
              )}
            </div>

            <Group gap="xs" wrap="nowrap" align="center">
              <Button
                variant="default"
                size="xs"
                onClick={handleCopySeats}
                style={{ borderRadius: tokens.radius.button }}
              >
                Copy seat list
              </Button>
              <Button
                variant="default"
                size="xs"
                onClick={handleExportCsv}
                style={{ borderRadius: tokens.radius.button }}
              >
                Export CSV
              </Button>
              <CloseButton
                onClick={onClose}
                aria-label="Close drawer"
                size="md"
              />
            </Group>
          </Group>

          {/* Section 1: Overview KPIs */}
          <SimpleGrid cols={3} spacing="sm">
            <Paper
              p="sm"
              withBorder
              style={{
                borderRadius: tokens.radius.card,
                backgroundColor: "var(--mb-header-bg)",
                textAlign: "center",
              }}
            >
              <Text size="xs" c="dimmed" fw={600} tt="uppercase">
                Total Seats
              </Text>
              <Text size="lg" fw={700} c="var(--mb-text)">
                {totalSeats}
              </Text>
            </Paper>

            <Paper
              p="sm"
              withBorder
              style={{
                borderRadius: tokens.radius.card,
                backgroundColor: "var(--mb-header-bg)",
                textAlign: "center",
              }}
            >
              <Text size="xs" c="dimmed" fw={600} tt="uppercase">
                Avg Margin
              </Text>
              <Text size="lg" fw={700} c="var(--mb-text)">
                {avgMarginText}
              </Text>
            </Paper>

            <Paper
              p="sm"
              withBorder
              style={{
                borderRadius: tokens.radius.card,
                backgroundColor: "var(--mb-header-bg)",
                textAlign: "center",
              }}
            >
              <Text size="xs" c="dimmed" fw={600} tt="uppercase">
                Vote Share
              </Text>
              <Text size="lg" fw={700} c="var(--mb-text)">
                {voteShareText}
              </Text>
            </Paper>
          </SimpleGrid>

          {/* Section 2: Demographic Drivers */}
          {cohort.demographicDrivers && cohort.demographicDrivers.length > 0 && (
            <Paper
              p="sm"
              withBorder
              style={{
                borderRadius: tokens.radius.card,
                backgroundColor: "var(--mb-header-bg)",
              }}
            >
              <Text size="xs" fw={600} c="dimmed" tt="uppercase" mb="xs">
                Demographic Drivers
              </Text>
              <Stack gap="xs">
                {cohort.demographicDrivers.map((driver) => (
                  <div key={driver.label}>
                    <Group justify="space-between" mb={2}>
                      <Text size="xs" fw={500} c="var(--mb-text)">
                        {driver.label}
                      </Text>
                      <Text size="xs" fw={600} c="var(--mb-text)">
                        {typeof driver.share === "number" ? `${driver.share}%` : driver.share}
                      </Text>
                    </Group>
                    <Progress
                      value={driver.share}
                      size="sm"
                      color="mb"
                      radius="xl"
                      aria-label={`${driver.label} ${driver.share}%`}
                    />
                  </div>
                ))}
              </Stack>
            </Paper>
          )}

          {/* Section 3: Seat Roster */}
          <Stack gap="xs">
            <Group justify="space-between" align="center">
              <Text size="xs" fw={600} c="dimmed" tt="uppercase">
                Seat Roster ({filteredSeats.length} of {cohort.seats.length})
              </Text>
            </Group>

            <TextInput
              placeholder="Search seats by name or number…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.currentTarget.value)}
              size="xs"
              style={{ borderRadius: tokens.radius.button }}
            />

            <div
              style={{
                maxHeight: 320,
                overflowY: "auto",
                border: "1px solid var(--mb-border)",
                borderRadius: tokens.radius.card,
              }}
            >
              <Table verticalSpacing="xs" horizontalSpacing="sm" highlightOnHover stickyHeader>
                <Table.Thead style={{ backgroundColor: "var(--mb-header-bg)" }}>
                  <Table.Tr>
                    <Table.Th style={{ fontSize: tokens.font.tableHeader, color: "var(--mb-text)", width: 60 }}>
                      #
                    </Table.Th>
                    <Table.Th style={{ fontSize: tokens.font.tableHeader, color: "var(--mb-text)" }}>
                      Seat Name
                    </Table.Th>
                    <Table.Th style={{ fontSize: tokens.font.tableHeader, color: "var(--mb-text)" }}>
                      Winner
                    </Table.Th>
                    <Table.Th
                      style={{
                        fontSize: tokens.font.tableHeader,
                        color: "var(--mb-text)",
                        textAlign: "right",
                      }}
                    >
                      Margin
                    </Table.Th>
                    <Table.Th
                      style={{
                        fontSize: tokens.font.tableHeader,
                        color: "var(--mb-text)",
                        textAlign: "center",
                      }}
                    >
                      Flip
                    </Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {filteredSeats.length === 0 ? (
                    <Table.Tr>
                      <Table.Td colSpan={5} style={{ textAlign: "center", padding: "20px 0" }}>
                        <Text size="xs" c="dimmed">
                          No seats match your search
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ) : (
                    filteredSeats.map((s, idx) => {
                      const num = s.ac_num ?? s.pc_num;
                      const flipStatus = s.flip ?? s.status;
                      const marginText =
                        s.margin_pp !== null && s.margin_pp !== undefined
                          ? `${s.margin_pp > 0 ? "+" : ""}${s.margin_pp.toFixed(1)} pp`
                          : "—";

                      return (
                        <Table.Tr key={`${num ?? idx}-${s.name}`}>
                          <Table.Td style={{ fontSize: tokens.font.rowLabel, color: "var(--mb-muted)" }}>
                            {num !== undefined ? `#${num}` : "—"}
                          </Table.Td>
                          <Table.Td
                            style={{
                              fontSize: tokens.font.rowLabel,
                              fontWeight: 500,
                              color: "var(--mb-text)",
                            }}
                          >
                            {s.name}
                          </Table.Td>
                          <Table.Td>
                            <Badge size="sm" variant="light" color="mb">
                              {s.winner}
                            </Badge>
                          </Table.Td>
                          <Table.Td
                            style={{
                              fontSize: tokens.font.delta,
                              textAlign: "right",
                              fontWeight: 600,
                              color:
                                s.margin_pp !== null && s.margin_pp > 0
                                  ? "var(--mb-gain)"
                                  : "var(--mb-text)",
                            }}
                          >
                            {marginText}
                          </Table.Td>
                          <Table.Td style={{ textAlign: "center" }}>
                            {flipStatus ? (
                              <Badge
                                size="xs"
                                variant="dot"
                                color={
                                  flipStatus === "gain"
                                    ? "green"
                                    : flipStatus === "loss"
                                    ? "red"
                                    : "gray"
                                }
                              >
                                {flipStatus}
                              </Badge>
                            ) : (
                              "—"
                            )}
                          </Table.Td>
                        </Table.Tr>
                      );
                    })
                  )}
                </Table.Tbody>
              </Table>
            </div>
          </Stack>
        </Stack>
      )}
    </Drawer>
  );
}
