// Academy and assistant names for every page, read from env at request time on the server.
// The defaults match .env.example.
export function academyName(): string {
  return process.env.DEMO_ACADEMY_NAME?.trim() || 'Brooklyn Youth Soccer Academy';
}

export function personaName(): string {
  return process.env.DEMO_AGENT_PERSONA_NAME?.trim() || 'Maya';
}
