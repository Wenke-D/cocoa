import type { ParamSpec } from '../../src/shared/params'

/** A parameter spec: a plain string unless `over` says otherwise. */
export const spec = (over: Partial<ParamSpec>): ParamSpec => ({
  name: 'p',
  type: 'string',
  values: null,
  list: false,
  description: 'a parameter',
  ...over
})
