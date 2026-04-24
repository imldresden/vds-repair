/**
 * Axis Visualization Module
 *
 * Provides various visualization methods for axis distributions in Parallel
 * Coordinate Plots (PCP). Includes violin plots, histograms, frequency bars,
 * and brushed histograms showing selections.
 *
 * Adapted from https://observablehq.com/@ssiegmund/violin-plot-playground
 *
 * @module axis
 */

import * as d3 from 'd3';

// ============================================================================
// Constants
// ============================================================================

/** Default aperture width for histogram bars */
const DEFAULT_APERTURE = 15;

/** Default number of bins for histograms */
const DEFAULT_BIN_COUNT = 30;

/** Default bandwidth for KDE in violin plots */
const DEFAULT_KDE_BANDWIDTH = 0.3;

// ============================================================================
// Violin Plot
// ============================================================================

/**
 * Draw a violin plot for an axis dimension.
 * Uses Kernel Density Estimation (KDE) with Epanechnikov kernel.
 *
 * @param {d3.Selection} svg - The axis SVG group
 * @param {Object} options - Configuration options
 * @param {boolean} options.orient - Orientation (true = vertical, false = horizontal)
 * @param {Object} options.resp - Response object with axes scales
 * @param {string} options.name - Dimension name
 * @param {Array} options.data - Data values for this dimension
 */
function violin(svg, {
  orient, resp, name, data,
} = {}) {
  if (resp.axes[name].linear) {
    // The .linear scale is set for nominals/booleans,
    // which don't make sense with violin plots
    return;
  }

  const scale = resp.axes[name];
  const apperture = 10;
  const bandwidth = DEFAULT_KDE_BANDWIDTH;
  const thds = scale.ticks(40);

  /**
   * Kernel Density Estimation function.
   * @param {Function} kernel - The kernel function
   * @param {Array} thresholds - Threshold values to evaluate
   * @returns {Function} KDE function
   */
  function kde(kernel, thresholds) {
    return (V) => thresholds.map((t) => [t, d3.mean(V, (d) => kernel(t - d))]);
  }

  /**
   * Epanechnikov kernel function.
   * @param {number} bw - Bandwidth
   * @returns {Function} Kernel function
   */
  function epanechnikov(bw) {
    return (x) => Math.abs((x /= bw)) <= 1 ? (0.75 * (1 - x * x)) / bw : 0;
  }

  const density = kde(epanechnikov(bandwidth), thds);
  const values = density(data);
  const max = d3.max(values.map((d) => d[1]));
  const s = d3
    .scaleLinear()
    .domain([-max, max])
    .range([-apperture, apperture]);

  const area = d3.area();

  if (orient) {
    area.y((d) => scale(d[0]))
      .x0((d) => s(-d[1]))
      .x1((d) => s(d[1]));
  } else {
    area.x((d) => scale(d[0]))
      .y0((d) => s(-d[1]))
      .y1((d) => s(d[1]));
  }

  area.curve(d3.curveCatmullRom);

  svg.append('g')
    .attr('class', 'violin')
    .append('path')
    .datum(values)
    .attr('d', area);
}

// ============================================================================
// Histogram
// ============================================================================

/**
 * Draw a histogram for an axis dimension.
 * Bins data into equal-width intervals and displays as bars.
 *
 * @param {d3.Selection} svg - The axis SVG group
 * @param {Object} options - Configuration options
 * @param {boolean} options.orient - Orientation (true = vertical, false = horizontal)
 * @param {Object} options.resp - Response object with axes scales
 * @param {string} options.name - Dimension name
 * @param {Array} options.data - Data values for this dimension
 */
function histogram(svg, {
  orient, resp, name, data,
} = {}) {
  svg.selectAll('.histogram').remove();

  const amount = DEFAULT_BIN_COUNT;
  const nominal = resp.axes[name].linear;
  const scale = nominal || resp.axes[name];
  const apperture = DEFAULT_APERTURE;

  const ds = data.map((d) => nominal ? +resp.axes[name].mapping[d] : scale(d)).sort();
  const dom = scale.domain().map((d) => scale(d));

  const pad = 0;
  const maxd = d3.max(dom) + pad;
  const step = maxd / amount;
  let i = d3.min(dom) - pad;

  const values = [];
  while (i < maxd) {
    if (maxd < i + (step + 1)) {
      // Last bin
      values.push([
        i,
        ds.filter((d) => d >= i).length,
        maxd - i,
      ]);
      i = maxd;
    } else {
      values.push([
        i,
        ds.filter((d) => d >= i && d < (i + step)).length,
        step,
      ]);
      i += step;
    }
  }

  const max = d3.max(values.map((d) => d[1]));

  const s = d3
    .scaleLinear()
    .domain([-max, max])
    .range([-apperture, apperture]);

  const bars = svg.append('g')
    .attr('class', 'histogram')
    .selectAll()
    .data(values)
    .enter()
    .append('rect');

  if (orient) {
    bars.attr('x', 0)
      .attr('y', (k) => k[0])
      .attr('width', (k) => s(k[1]))
      .attr('height', (k) => k[2]);
  } else {
    bars.attr('y', 0)
      .attr('x', (k) => k[0])
      .attr('height', (k) => s(k[1]))
      .attr('width', (k) => k[2]);
  }
}

// ============================================================================
// Frequency Bars
// ============================================================================

/**
 * Draw frequency bars for an axis dimension.
 * Shows pre-computed counts at specific values.
 *
 * Note: This is based on counts done over the values of each property.
 * Close decimal imprecisions can make it so that bars overlap.
 *
 * @param {d3.Selection} svg - The axis SVG group
 * @param {Object} options - Configuration options
 * @param {Object} options.counts - Object mapping dimension names to value counts
 * @param {string} options.name - Dimension name
 * @param {boolean} options.orient - Orientation (true = vertical, false = horizontal)
 */
function frequencies(svg, { counts, name, orient }) {
  svg.selectAll('.bars').remove();

  const apperture = DEFAULT_APERTURE;
  const max = d3.max(Object.values(counts[name]));
  const s = d3
    .scaleLinear()
    .domain([-max, max])
    .range([-apperture, apperture]);

  const height = 1;
  const bars = svg.append('g')
    .attr('class', 'bars')
    .selectAll()
    .data(Object.keys(counts[name]))
    .enter()
    .append('rect');

  if (orient) {
    bars.attr('x', 0)
      .attr('y', (k) => (+k) - (height / 2))
      .attr('width', (k) => s(counts[name][k]))
      .attr('height', height);
  } else {
    bars.attr('x', (k) => (+k) - (height / 2))
      .attr('y', 0)
      .attr('width', height)
      .attr('height', (k) => s(counts[name][k]));
  }
}

// ============================================================================
// Brushed Histogram (for PCP selections)
// ============================================================================

/**
 * Draw a brushed histogram showing both total distribution (gray) and brushed selection (colored).
 * This is used in PCP views to show how the current brush selection compares to the full distribution.
 *
 * @param {d3.Selection} svg - The axis SVG group
 * @param {Object} options - Configuration object
 * @param {boolean} options.orient - Orientation (true = vertical, false = horizontal)
 * @param {Object} options.resp - Response object with axes scales
 * @param {string} options.name - Dimension name
 * @param {Array} options.allData - All data values for this dimension
 * @param {Array} options.brushedData - Brushed/selected data values for this dimension
 * @param {string} [options.brushedColor='#3b82f6'] - Color for the brushed histogram bars
 */
function brushedHistogram(svg, {
  orient, resp, name, allData, brushedData, brushedColor = '#3b82f6',
} = {}) {
  svg.selectAll('.brushed-histogram').remove();

  const amount = 20;
  const nominal = resp.axes[name].linear;
  const scale = nominal || resp.axes[name];
  const apperture = 18;

  /**
   * Bin data into equal-width intervals.
   * @param {Array} dataArray - Data values to bin
   * @returns {Array<Object>} Array of bin objects with pos, count, and width
   */
  function binData(dataArray) {
    const ds = dataArray.map((d) => nominal ? +resp.axes[name].mapping[d] : scale(d)).sort((a, b) => a - b);
    const dom = scale.domain().map((d) => scale(d));

    const pad = 0;
    const mind = d3.min(dom) - pad;
    const maxd = d3.max(dom) + pad;
    const step = (maxd - mind) / amount;
    let i = mind;
    
    const values = [];
    while (i < maxd) {
      if (maxd < i + (step + 1)) { // last bin
        values.push({
          pos: i,
          count: ds.filter(d => d >= i).length,
          width: maxd - i,
        });
        i = maxd;
      } else {
        values.push({
          pos: i,
          count: ds.filter(d => d >= i && d < (i + step)).length,
          width: step,
        });
        i += step;
      }
    }
    return values;
  }

  const allBins = binData(allData);
  const brushedBins = binData(brushedData);
  
  // Find max across all data for consistent scaling
  const maxAll = d3.max(allBins.map(d => d.count));
  if (maxAll === 0) return; // No data to show
  
  const s = d3.scaleLinear()
    .domain([0, maxAll])
    .range([0, apperture]);

  const g = svg.append('g')
    .attr('class', 'brushed-histogram');

  // Draw all-data bars (background, darker gray for better visibility)
  const allBars = g.selectAll('.hist-all')
    .data(allBins)
    .enter()
    .append('rect')
    .attr('class', 'hist-all')
    .attr('fill', '#9ca3af')
    .attr('opacity', 0.8);

  // Draw brushed bars (foreground, colored)
  const brushedBars = g.selectAll('.hist-brushed')
    .data(brushedBins)
    .enter()
    .append('rect')
    .attr('class', 'hist-brushed')
    .attr('fill', brushedColor)
    .attr('opacity', 0.85);

  if (orient) {
    // Vertical orientation: bars extend horizontally from axis
    allBars
      .attr('x', 2)
      .attr('y', d => d.pos)
      .attr('width', d => s(d.count))
      .attr('height', d => d.width);
    
    brushedBars
      .attr('x', 2)
      .attr('y', d => d.pos)
      .attr('width', d => s(d.count))
      .attr('height', d => d.width);
  } else {
    // Horizontal orientation: bars extend vertically from axis
    allBars
      .attr('x', d => d.pos)
      .attr('y', d => -s(d.count))
      .attr('width', d => d.width)
      .attr('height', d => s(d.count));
    
    brushedBars
      .attr('x', d => d.pos)
      .attr('y', d => -s(d.count))
      .attr('width', d => d.width)
      .attr('height', d => s(d.count));
  }
}

export { violin, histogram, frequencies, brushedHistogram };
