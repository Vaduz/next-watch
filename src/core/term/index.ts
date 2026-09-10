/** The `next-watch/term` subpath: measuring, colouring and framing terminal output.
 *  Nothing here reads a clock or a terminal — the caller supplies the width and the time. */
export {
  BODY_INDENT,
  bar,
  cell,
  chromeLines,
  clockAt,
  detailLine,
  eventLine,
  formatUptime,
  frame,
  hourMinuteAt,
  markGlyph,
  painter,
  renderCells,
  type Cell,
  type FramePane,
  type Mark,
  type Paint,
  type RowTone,
  type Tone,
} from './termView.js';
export { clipDisplay, displayWidth, padDisplay, padRow, truncateDisplay, wrapDisplay } from './textWidth.js';
