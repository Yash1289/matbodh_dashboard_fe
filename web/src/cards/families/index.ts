import type { ComponentType } from "react";
import type { GridFamily } from "../../api/types";
import { DistributionBody } from "./distribution";
import { GenderDifferentialBody } from "./gender_differential";
import type { GridBodyProps } from "./_grid/GridBody";
import { OpinionBody } from "./opinion";

export type FamilyBodyProps = GridBodyProps;

/** One body per grid result family (ranking families have their own card, cards/ranking/). */
export const FAMILY_BODIES: Record<GridFamily, ComponentType<FamilyBodyProps>> = {
  distribution: DistributionBody,
  opinion: OpinionBody,
  gender_differential: GenderDifferentialBody,
};
