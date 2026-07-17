var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
import { acquireProtectedResourceUrl, isProtectedResourceUrl, } from '@/services/protected-resource';
export function resolveCanvasDisplayUrlLoadingEnabled(override, envValue) {
    var _a;
    if (envValue === void 0) { envValue = (_a = import.meta.env) === null || _a === void 0 ? void 0 : _a.VITE_IMAGE_CANVAS_DISPLAY_URL_LOADING; }
    if (typeof override === 'boolean') {
        return override;
    }
    return envValue === 'true';
}
export function resolveCanvasLoadStrategy(override, options) {
    if (options === void 0) { options = {}; }
    if (override) {
        return override;
    }
    return resolveCanvasDisplayUrlLoadingEnabled(options.displayUrlEnabled, options.envValue)
        ? 'display-url'
        : 'decode';
}
function estimateBytes(width, height) {
    return Math.max(0, width) * Math.max(0, height) * 4;
}
export function loadImageResource(url_1) {
    return __awaiter(this, arguments, void 0, function (url, strategy, options) {
        var protectedResource, protectedHandle_1, protectedDisplayHandle, _a, blobHandle, _b, bitmap_1, _c, image, imageSrc, error_1;
        var _d;
        var _this = this;
        var _e, _f, _g;
        if (strategy === void 0) { strategy = 'decode'; }
        if (options === void 0) { options = {}; }
        return __generator(this, function (_h) {
            switch (_h.label) {
                case 0:
                    protectedResource = isProtectedResourceUrl(url);
                    if (!(strategy === 'display-url')) return [3 /*break*/, 2];
                    return [4 /*yield*/, acquireProtectedResourceUrl(url, {
                            persistentEnabled: options.preferPersistentCache,
                            persistentVersion: options.persistentVersion,
                        })];
                case 1:
                    protectedHandle_1 = _h.sent();
                    return [2 /*return*/, {
                            src: protectedHandle_1.url,
                            width: 0,
                            height: 0,
                            decoded: 'display-url',
                            estimatedBytes: 0,
                            handle: {
                                close: function () {
                                    protectedHandle_1.release();
                                },
                            },
                        }];
                case 2:
                    if (!protectedResource) return [3 /*break*/, 4];
                    return [4 /*yield*/, acquireProtectedResourceUrl(url, {
                            persistentEnabled: options.preferPersistentCache,
                            persistentVersion: options.persistentVersion,
                        })];
                case 3:
                    _a = _h.sent();
                    return [3 /*break*/, 5];
                case 4:
                    _a = undefined;
                    _h.label = 5;
                case 5:
                    protectedDisplayHandle = _a;
                    if (!protectedResource) return [3 /*break*/, 6];
                    _b = {
                        blob: (_e = protectedDisplayHandle === null || protectedDisplayHandle === void 0 ? void 0 : protectedDisplayHandle.blob) !== null && _e !== void 0 ? _e : new Blob(),
                        release: function () { return protectedDisplayHandle === null || protectedDisplayHandle === void 0 ? void 0 : protectedDisplayHandle.release(); },
                    };
                    return [3 /*break*/, 8];
                case 6:
                    _d = {};
                    return [4 /*yield*/, (function () { return __awaiter(_this, void 0, void 0, function () {
                            var response;
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0: return [4 /*yield*/, fetch(url)];
                                    case 1:
                                        response = _a.sent();
                                        if (!response.ok) {
                                            throw new Error("Failed to fetch image resource: ".concat(url));
                                        }
                                        return [2 /*return*/, response.blob()];
                                }
                            });
                        }); })()];
                case 7:
                    _b = (_d.blob = _h.sent(),
                        _d.release = function () { return undefined; },
                        _d);
                    _h.label = 8;
                case 8:
                    blobHandle = _b;
                    if (!(typeof createImageBitmap === 'function')) return [3 /*break*/, 12];
                    _h.label = 9;
                case 9:
                    _h.trys.push([9, 11, , 12]);
                    return [4 /*yield*/, createImageBitmap(blobHandle.blob)];
                case 10:
                    bitmap_1 = _h.sent();
                    return [2 /*return*/, {
                            src: (_f = protectedDisplayHandle === null || protectedDisplayHandle === void 0 ? void 0 : protectedDisplayHandle.url) !== null && _f !== void 0 ? _f : url,
                            width: bitmap_1.width,
                            height: bitmap_1.height,
                            decoded: 'bitmap',
                            estimatedBytes: estimateBytes(bitmap_1.width, bitmap_1.height),
                            handle: {
                                close: function () {
                                    bitmap_1.close();
                                    blobHandle.release();
                                },
                            },
                        }];
                case 11:
                    _c = _h.sent();
                    return [3 /*break*/, 12];
                case 12:
                    image = new Image();
                    image.decoding = 'async';
                    imageSrc = (_g = protectedDisplayHandle === null || protectedDisplayHandle === void 0 ? void 0 : protectedDisplayHandle.url) !== null && _g !== void 0 ? _g : url;
                    _h.label = 13;
                case 13:
                    _h.trys.push([13, 15, , 16]);
                    return [4 /*yield*/, new Promise(function (resolve, reject) {
                            image.onload = function () { return resolve(); };
                            image.onerror = function () { return reject(new Error("Failed to load image resource: ".concat(url))); };
                            image.src = imageSrc;
                        })];
                case 14:
                    _h.sent();
                    return [2 /*return*/, {
                            src: imageSrc,
                            width: image.naturalWidth,
                            height: image.naturalHeight,
                            decoded: 'image',
                            estimatedBytes: estimateBytes(image.naturalWidth, image.naturalHeight),
                            handle: {
                                close: function () {
                                    image.src = '';
                                    blobHandle.release();
                                },
                            },
                        }];
                case 15:
                    error_1 = _h.sent();
                    image.src = '';
                    blobHandle.release();
                    throw error_1;
                case 16: return [2 /*return*/];
            }
        });
    });
}
