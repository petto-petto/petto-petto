// macOS 전용: Electron이 노출하지 않는 NSWindow collectionBehavior 를 koffi(런타임 FFI)로 직접 설정.
// 핵심: NSWindowCollectionBehaviorStationary → "배경 클릭 시 데스크탑 표시 / Show Desktop"에도 창이 밀려나지 않음.
// (Clawd on Desk 의 src/mac-window.js 방식을 프로토타입용으로 축약 — SkyLight 사설 스페이스 트릭은 제외)
const isMac = process.platform === 'darwin';

// NSWindowCollectionBehavior enum
const CanJoinAllSpaces = 1 << 0;
const MoveToActiveSpace = 1 << 1;
const Managed = 1 << 2;
const Transient = 1 << 3;
const Stationary = 1 << 4;
const ParticipatesInCycle = 1 << 5;
const IgnoresCycle = 1 << 6;
const FullScreenPrimary = 1 << 7;
const FullScreenAuxiliary = 1 << 8;
const FullScreenNone = 1 << 9;
const FullScreenAllowsTiling = 1 << 11;
const FullScreenDisallowsTiling = 1 << 12;
const Primary = 1 << 16;
const Auxiliary = 1 << 17;
const CanJoinAllApplications = 1 << 18;
const NSWindowAnimationBehaviorNone = 2;
const CGAssistiveTechHighWindowLevel = 1500;

let objc = null;
let sel = null;
let warned = false;

function initObjc() {
  if (objc) return objc;
  const koffi = require('koffi');
  const libobjc = koffi.load('/usr/lib/libobjc.A.dylib');
  const sel_registerName = libobjc.func('void *sel_registerName(const char *name)');
  objc = {
    msgPtr: libobjc.func('objc_msgSend', 'void *', ['void *', 'void *']),
    msgULong: libobjc.func('objc_msgSend', 'ulong', ['void *', 'void *']),
    msgVoidULong: libobjc.func('objc_msgSend', 'void', ['void *', 'void *', 'ulong']),
    msgVoidLong: libobjc.func('objc_msgSend', 'void', ['void *', 'void *', 'long']),
    msgVoidBool: libobjc.func('objc_msgSend', 'void', ['void *', 'void *', 'bool']),
  };
  sel = {
    window: sel_registerName('window'),
    collectionBehavior: sel_registerName('collectionBehavior'),
    setCollectionBehavior: sel_registerName('setCollectionBehavior:'),
    setCanHide: sel_registerName('setCanHide:'),
    setHidesOnDeactivate: sel_registerName('setHidesOnDeactivate:'),
    setAnimationBehavior: sel_registerName('setAnimationBehavior:'),
    setLevel: sel_registerName('setLevel:'),
  };
  return objc;
}

function nativeHandleToPointer(handle) {
  if (!handle || handle.length < 8) return null;
  const ptr = handle.readBigUInt64LE(0);
  return ptr === 0n ? null : ptr;
}

// 창을 "고정(stationary)"으로 만들어 배경 클릭/Show Desktop 에도 밀려나지 않게 한다.
function applyStationaryCollectionBehavior(win) {
  if (!isMac || !win || win.isDestroyed()) return false;
  try {
    const { msgPtr, msgULong, msgVoidULong, msgVoidLong, msgVoidBool } = initObjc();
    const nsView = nativeHandleToPointer(win.getNativeWindowHandle());
    if (!nsView) return false;
    const nsWindow = msgPtr(nsView, sel.window); // NSView -> 소속 NSWindow
    if (!nsWindow) return false;

    const current = Number(msgULong(nsWindow, sel.collectionBehavior)) || 0;
    const clearMask =
      MoveToActiveSpace | Managed | Transient | ParticipatesInCycle |
      FullScreenPrimary | FullScreenNone | FullScreenAllowsTiling |
      Primary | Auxiliary | CanJoinAllApplications;
    const setMask =
      CanJoinAllSpaces | Stationary | FullScreenAuxiliary | IgnoresCycle | FullScreenDisallowsTiling;
    const next = (current & ~clearMask) | setMask;
    if (next !== current) msgVoidULong(nsWindow, sel.setCollectionBehavior, next);

    msgVoidBool(nsWindow, sel.setCanHide, false);            // 앱 숨김에도 안 사라짐
    msgVoidBool(nsWindow, sel.setHidesOnDeactivate, false);  // 앱 비활성화(다른 앱 클릭)에도 안 사라짐
    msgVoidLong(nsWindow, sel.setAnimationBehavior, NSWindowAnimationBehaviorNone);
    msgVoidLong(nsWindow, sel.setLevel, CGAssistiveTechHighWindowLevel); // 매우 높은 레벨
    return true;
  } catch (err) {
    if (!warned) {
      console.warn('[mac-window] stationary 적용 실패:', err.message);
      warned = true;
    }
    return false;
  }
}

module.exports = { applyStationaryCollectionBehavior };
