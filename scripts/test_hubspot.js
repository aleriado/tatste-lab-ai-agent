"use strict";
/// <reference types="node" />
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.listContacts = listContacts;
exports.createTestContact = createTestContact;
/**
 * Minimal HubSpot REST test script (Node 18+, TypeScript).
 *
 * Usage:
 * 1) Create a `.env` file in the repo root (or update it) and set:
 *      HUBSPOT_ACCESS_TOKEN=your_private_app_token_here
 * 2) Ensure the env var is loaded when running this script, for example:
 *      # If you use dotenv:
 *      pnpm exec node -r dotenv/config scripts/test_hubspot.ts
 *      # Or export directly in your shell:
 *      export HUBSPOT_ACCESS_TOKEN=your_token_here
 *      pnpm exec ts-node scripts/test_hubspot.ts
 *
 * This script:
 *  - Lists up to 1 existing contact and prints id/email.
 *  - Creates a test contact with email ai_test_<timestamp>@tastelabs.co.il
 *    and prints its id/email.
 *
 * NOTE: The HubSpot token is never logged.
 */
/* eslint-disable no-console */
// Load .env from current working directory (repo root when run via pnpm exec)
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
var dotenv = require('dotenv');
dotenv.config();
var HUBSPOT_BASE_URL = 'https://api.hubapi.com';
function getAccessToken() {
    var token = process.env.HUBSPOT_ACCESS_TOKEN;
    if (!token) {
        throw new Error('HUBSPOT_ACCESS_TOKEN is not set. Add it to your .env or export it in your shell.');
    }
    return token;
}
function hubspotRequest(path, options) {
    return __awaiter(this, void 0, void 0, function () {
        var token, url, res, bodyText, retryAfter;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    token = getAccessToken();
                    url = "".concat(HUBSPOT_BASE_URL).concat(path);
                    return [4 /*yield*/, fetch(url, __assign(__assign({}, options), { headers: __assign({ Authorization: "Bearer ".concat(token), 'Content-Type': 'application/json' }, ((_a = options.headers) !== null && _a !== void 0 ? _a : {})) }))];
                case 1:
                    res = _b.sent();
                    if (!!res.ok) return [3 /*break*/, 3];
                    return [4 /*yield*/, res.text().catch(function () { return ''; })];
                case 2:
                    bodyText = _b.sent();
                    if (res.status === 401 || res.status === 403) {
                        console.error('Auth/scopes issue', bodyText);
                    }
                    else if (res.status === 429) {
                        retryAfter = res.headers.get('retry-after');
                        console.error('Rate limited' + (retryAfter ? " (retry-after: ".concat(retryAfter, ")") : ''), bodyText);
                    }
                    else {
                        console.error("Status ".concat(res.status, ":"), bodyText);
                    }
                    throw new Error("HubSpot request failed with status ".concat(res.status));
                case 3: return [2 /*return*/, res.json()];
            }
        });
    });
}
/**
 * List HubSpot contacts (limited) and return the raw results array.
 */
function listContacts() {
    return __awaiter(this, arguments, void 0, function (limit) {
        var searchParams, data;
        var _a;
        if (limit === void 0) { limit = 1; }
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    searchParams = new URLSearchParams({
                        limit: String(limit),
                        properties: 'email'
                    });
                    return [4 /*yield*/, hubspotRequest("/crm/v3/objects/contacts?".concat(searchParams.toString()), {
                            method: 'GET'
                        })];
                case 1:
                    data = _b.sent();
                    return [2 /*return*/, (_a = data === null || data === void 0 ? void 0 : data.results) !== null && _a !== void 0 ? _a : []];
            }
        });
    });
}
/**
 * Create a test contact with a given email.
 * The lifecyclestage property is included as \"lead\"; if your HubSpot
 * account does not allow setting it this way, you may remove that line.
 */
function createTestContact(email) {
    return __awaiter(this, void 0, void 0, function () {
        var body, data;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    body = {
                        properties: {
                            email: email,
                            firstname: 'AI',
                            lastname: 'Test',
                            lifecyclestage: 'lead'
                        }
                    };
                    return [4 /*yield*/, hubspotRequest('/crm/v3/objects/contacts', {
                            method: 'POST',
                            body: JSON.stringify(body)
                        })];
                case 1:
                    data = _a.sent();
                    return [2 /*return*/, data];
            }
        });
    });
}
function main() {
    return __awaiter(this, void 0, void 0, function () {
        var contacts, first, email_1, email, created, createdEmail, err_1;
        var _a, _b, _c, _d;
        return __generator(this, function (_e) {
            switch (_e.label) {
                case 0:
                    _e.trys.push([0, 3, , 4]);
                    console.log('Listing up to 1 existing HubSpot contact...');
                    return [4 /*yield*/, listContacts(1)];
                case 1:
                    contacts = _e.sent();
                    if (contacts.length > 0) {
                        first = contacts[0];
                        email_1 = (_b = (_a = first === null || first === void 0 ? void 0 : first.properties) === null || _a === void 0 ? void 0 : _a.email) !== null && _b !== void 0 ? _b : null;
                        console.log('First contact:', { id: first.id, email: email_1 });
                    }
                    else {
                        console.log('No contacts found.');
                    }
                    email = "ai_test_".concat(Date.now(), "@tastelabs.co.il");
                    console.log('Creating test contact with email:', email);
                    return [4 /*yield*/, createTestContact(email)];
                case 2:
                    created = _e.sent();
                    createdEmail = (_d = (_c = created === null || created === void 0 ? void 0 : created.properties) === null || _c === void 0 ? void 0 : _c.email) !== null && _d !== void 0 ? _d : email;
                    console.log('Created contact:', { id: created.id, email: createdEmail });
                    return [3 /*break*/, 4];
                case 3:
                    err_1 = _e.sent();
                    console.error('HubSpot test script failed.', err_1);
                    process.exitCode = 1;
                    return [3 /*break*/, 4];
                case 4: return [2 /*return*/];
            }
        });
    });
}
// Run when invoked directly (node / ts-node scripts/test_hubspot.ts)
if (require.main === module) {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    main();
}
