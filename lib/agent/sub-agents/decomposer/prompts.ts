/**
 * Prompt key mapping for decomposer agent levels (R1-R4).
 *
 * The actual prompt content lives in lib/prompt-defaults.ts under keys
 * decomposer_r1_agent, decomposer_r2_agent, decomposer_r3_agent, decomposer_r4_agent.
 * This module only provides key names and a fallback resolution helper.
 */
export const AGENT_PROMPT_KEYS = [
  "decomposer_r1_agent",
  "decomposer_r2_agent",
  "decomposer_r3_agent",
  "decomposer_r4_agent",
] as const;

