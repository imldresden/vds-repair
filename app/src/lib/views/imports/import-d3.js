import {
  extent, scalePoint, scaleLinear, axisTop, axisLeft, pointer, drag, brushX, brushY, brush,
} from 'd3';
import { select, selectAll } from 'd3-selection';
import { transition } from 'd3-transition';

const d3 = {
  select,
  selectAll,
  extent,
  scalePoint,
  scaleLinear,
  axisTop,
  axisLeft,
  pointer,
  drag,
  brushX,
  brushY,
  brush,
};

transition();

export default d3;
