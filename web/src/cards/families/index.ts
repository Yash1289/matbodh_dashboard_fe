import type { ComponentType } from "react";
import type { Family } from "../../api/types";
import { DistributionBody } from "./distribution";
import { GenderDifferentialBody } from "./gender_differential";
import type { GridBodyProps } from "./_grid/GridBody";
import { OpinionBody } from "./opinion";

export type FamilyBodyProps = GridBodyProps;

/** One body per engine result family; a family with extra data adds its own layer in its own folder. */
export const FAMILY_BODIES: Record<Family, ComponentType<FamilyBodyProps>> = {
  distribution: DistributionBody,
  opinion: OpinionBody,
  gender_differential: GenderDifferentialBody,
};
