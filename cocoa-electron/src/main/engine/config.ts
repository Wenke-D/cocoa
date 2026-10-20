/** Timeouts (convention §6), in milliseconds. */
export interface Config {
  launch_timeout: number
  poll_timeout: number
  cancel_timeout: number
  plan_timeout: number
  report_timeout: number
  check_timeout: number
  deploy_timeout: number
}

export const DEFAULT_CONFIG: Config = {
  launch_timeout: 60_000,
  poll_timeout: 60_000,
  cancel_timeout: 60_000,
  plan_timeout: 120_000,
  report_timeout: 600_000,
  check_timeout: 60_000,
  // A deploy may build what it puts in place; it gets the report's allowance.
  deploy_timeout: 600_000
}
