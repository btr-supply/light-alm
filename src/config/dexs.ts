import { type DexId, type DexFamily, DexId as DI, DexFamily as DF } from "../types";

// Re-export ABIs from dedicated file
export { ABIS } from "./abis";

// DEX registry: slug -> type + chain-specific addresses
interface DEXEntry {
  type: "univ3" | "algebra" | "lb";
  positionManager: Record<number, `0x${string}`>;
}

export const dexes: Record<string, DEXEntry> = {
  [DI.UNI_V3]: {
    type: "univ3",
    positionManager: {
      1: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
      56: "0x7b8A01B39D58278b5DE7e48c8449c9f4F5170613",
      137: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
      8453: "0x03a520b32C04BF3bEEf7BEb72E583e6d4ef98D81",
      42161: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
      43114: "0x655C406EBFa14EE2006250925e54ec43AD184f8B",
    },
  },
  [DI.PCS_V3]: {
    type: "univ3",
    positionManager: {
      1: "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364",
      56: "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364",
      8453: "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364",
      42161: "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364",
    },
  },
  [DI.AERO_V3]: {
    type: "univ3",
    positionManager: {
      8453: "0x827922686190790b37229fd06084350E74485b72",
    },
  },
  [DI.CAMELOT_V3]: {
    type: "algebra",
    positionManager: {
      42161: "0x00c7f3082833e796A5b3e4Bd59f6642FF44DCD15",
    },
  },
  [DI.QUICKSWAP_V3]: {
    type: "algebra",
    positionManager: {
      137: "0x8eF88E4c7CfbbaC1C163f7eddd4B578792201de6",
    },
  },
  [DI.RAMSES_V3]: {
    type: "univ3",
    positionManager: {
      42161: "0xAA277CB7914b7e5514946Da92cb9De332Ce610EF",
      999: "0xB3F77C5134D643483253D22E0Ca24627aE42ED51",
    },
  },
  [DI.PANGOLIN_V3]: {
    type: "univ3",
    positionManager: {
      43114: "0xf40937279F38D0c1f97aFA5919F1cB3cB7f06A7F",
    },
  },
  [DI.BLACKHOLE_V3]: {
    type: "algebra",
    positionManager: {
      43114: "0x3fED017EC0f5517Cdf2E8a9a4156c64d74252146",
    },
  },
  [DI.PHARAOH_V3]: {
    type: "univ3",
    positionManager: {
      43114: "0xAAA78E8C4241990B4ce159E105dA08129345946A",
    },
  },
  [DI.PROJECT_X_V3]: {
    type: "univ3",
    positionManager: {
      999: "0xead19ae861c29bbb2101e834922b2feee69b9091",
    },
  },
  [DI.JOE_V2]: {
    type: "lb",
    positionManager: {
      // LB router addresses
      43114: "0xE3Ffc583dC176575eEA7FD9dF2A7c65F7E23f4C3",
    },
  },
  [DI.JOE_V21]: {
    type: "lb",
    positionManager: {
      43114: "0xb4315e873dBcf96Ffd0acd8EA43f689D8c20fB30",
    },
  },
  [DI.JOE_V22]: {
    type: "lb",
    positionManager: {
      43114: "0x18556DA13313f3532c54711497A8FedAC273220E",
    },
  },
};

export const getDex = (slug: string) => {
  const d = dexes[slug];
  if (!d) throw new Error(`Unknown DEX: ${slug}`);
  return d;
};

// ---- V4 lens contracts ----

export const V4_STATE_VIEW: Record<number, `0x${string}`> = {
  1: "0x7ffe42c4a5deea5b0fec41c94c136cf115597227",
  56: "0xd13dd3d6e93f276fafc9db9e6bb47c1180aee0c4",
  137: "0x5ea1bd7974c8a611cbab0bdcafcb1d9cc9b3ba5a",
  8453: "0xa3c0c9b65bad0b08107aa264b0f3db444b867a71",
  42161: "0x76fd297e2d437cd7f76d50f01afe6160f86e9990",
  43114: "0x3e3964d45ba7e79f3adbb832ceff5123f93a4740",
  999: "0x4b7e47e47b5d35dbc1c0b3eb1e5e49b42578a8a0",
};

export const PCS_V4_CL_MANAGER: Record<number, `0x${string}`> = {
  56: "0xa0FfB9c1CE1Fe56963B0321B32E7A0302114058b",
};

// ---- V4 PositionManager contracts ----

export const V4_POSITION_MANAGER: Record<number, `0x${string}`> = {
  1: "0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e",
  56: "0x7a4a5c919ae2541aed11041a1aeee68f1287f95b",
  137: "0x1ec2ebf4f37e7363fdfe3551602425af0b3ceef9",
  8453: "0x7c5f5a4bbd8fd63184577525326123b519429bdc",
  42161: "0xd88f38f930b7952f2db2432cb002e7abbf3dd869",
  43114: "0xb74b1f14d2754acfcbbe1a221023a5cf50ab8acd",
};

export const PCS_V4_POSITION_MANAGER: Record<number, `0x${string}`> = {
  56: "0x55f4c8abA71A1e923edC303eb4fEfF14608cC226",
};

// ---- DexId → DexFamily mapping ----

export const DEX_FAMILY: Record<DexId, DexFamily> = {
  [DI.UNI_V3]: DF.V3,
  [DI.PCS_V3]: DF.V3,
  [DI.PANGOLIN_V3]: DF.V3,
  [DI.BLACKHOLE_V3]: DF.ALGEBRA,
  [DI.PHARAOH_V3]: DF.V3,
  [DI.PROJECT_X_V3]: DF.V3,
  [DI.RAMSES_V3]: DF.V3,
  [DI.AERO_V3]: DF.AERODROME,
  [DI.CAMELOT_V3]: DF.ALGEBRA,
  [DI.QUICKSWAP_V3]: DF.ALGEBRA,
  [DI.UNI_V4]: DF.V4,
  [DI.HYBRA_V4]: DF.V4,
  [DI.PCS_V4]: DF.PCS_V4,
  [DI.JOE_V2]: DF.LB,
  [DI.JOE_V21]: DF.LB,
  [DI.JOE_V22]: DF.LB,
};

export const getDexFamily = (id: DexId): DexFamily => DEX_FAMILY[id];
