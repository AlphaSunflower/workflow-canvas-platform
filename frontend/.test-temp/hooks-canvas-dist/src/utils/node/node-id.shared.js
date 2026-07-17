export var MAX_NODE_ID = 99999;
export var NODE_ID_EXHAUSTED_ERROR = 'Node ID exhausted: maximum of 99999 nodes reached';
export function generateNodeId(sequence) {
    if (sequence < 1 || sequence > MAX_NODE_ID) {
        throw new Error("Invalid node ID sequence: ".concat(sequence, ". Must be between 1 and ").concat(MAX_NODE_ID));
    }
    var value = String(sequence);
    var display = "#".concat(value.padStart(5, '0'));
    return { value: value, display: display };
}
