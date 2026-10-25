import { plan, statesOf } from './states.mjs';

export const OVERLAYS = statesOf(plan('cutoff'), 'overlay');

export const overlaysFor = (list, route, cell) => list.filter((o) => o.route === route && o.cells.includes(cell));
