import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { WEB_BUILD_ID } from "./build-info";
import eutherDogsManifestToml from "../assets/eutherdogs/manifest.toml?raw";
import shaderToml from "./shaders.toml?raw";
import "./styles.css";

const controllerGuideUrl = new URL("./controller-bindings.svg", import.meta.url).href;
const eutherDogsAssetModules = import.meta.glob("../assets/eutherdogs/**/*.{png,wav,ogg,mp3}", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;
const eutherCivetGameUrl = "/euthercivet-game/index.html";
const eutheriumIconModules = import.meta.glob("../assets/eutherium/icons/*.png", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    webkitAudioContext?: typeof AudioContext;
    Dos?: (element: HTMLElement, options: Record<string, unknown>) => { stop?: () => Promise<void> };
  }
}

type LoadResult = {
  title: string;
  region: string;
  timing: string;
  resetPc: number;
  width: number;
  height: number;
  statePath?: string | null;
};

type BridgeStatusResult = LoadResult & {
  loaded?: boolean;
  frame: number;
};

type BridgeBuildStatus = {
  activeProfile: "debug" | "release" | string;
  requestedProfile: "debug" | "release" | string;
  building: boolean;
  releaseReady: boolean;
  armed: boolean;
  lastStatus: string;
  lastMessage: string;
  releasePath: string;
  updatedUnixMs: number;
};

type FrameResult = {
  frame: number;
  width: number;
  height: number;
  rgba: number[] | Uint8Array<ArrayBuffer> | Uint8ClampedArray<ArrayBuffer>;
  cpuCycles: number;
  cpuSteps: number;
  frameMs: number;
  stopped: boolean;
  lastError?: string | null;
};

type AudioResult = {
  frame: number;
  sampleRate: number;
  samples: number[] | Int16Array<ArrayBuffer>;
  channels?: number;
};

type FrameAudioResult = {
  frame: FrameResult;
  audio: AudioResult;
  transport: string;
  videoFormat?: string;
};

type DecodedFrameAudioPacket = FrameAudioResult & {
  videoBytes?: Uint8Array<ArrayBufferLike>;
  videoOffset?: number;
  videoLength?: number;
};

type NativeAudioResult = {
  active: boolean;
  queuedMs: number;
};

type NativeFrameResult = {
  frame: number;
  width: number;
  height: number;
  rgba: number[] | Uint8Array<ArrayBuffer> | Uint8ClampedArray<ArrayBuffer>;
  frameRate: number;
  cpuCycles: number;
  cpuSteps: number;
  frameMs: number;
  stopped: boolean;
  lastError?: string | null;
  audioActive: boolean;
  audioLeadMs: number;
};

type InputState = {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  a: boolean;
  b: boolean;
  c: boolean;
  start: boolean;
};

type InputName = keyof InputState;
type DogsBindingName =
  | InputName
  | "inventory"
  | "map"
  | "weapon1"
  | "weapon2"
  | "weapon3"
  | "weapon4"
  | "weapon5"
  | "answerYes"
  | "answerNo"
  | "answerOther";
type BindingScope = "global" | "dogs";
type PlayerPort = 1 | 2;
type LobbyRole = "player" | "spectator";
type DogsAssetMode = "classic" | "2x";
type DogsCharacterKey = "night_shift_tech" | "neon_pharmacist";
type DogsBridgeInput = InputState & {
  player: PlayerPort;
  seq?: number;
  weaponSlot?: number;
  inspectionAnswer?: "yes" | "no" | "other";
};

type LobbyPlayer = {
  player: number;
  occupied: boolean;
  user?: string | null;
};

type LobbyInstance = {
  id: string;
  name: string;
  kind?: "megadrive" | "eutheralert" | "eutherdoom";
  modeLabel?: string;
  loaded: boolean;
  title: string;
  frame: number;
  players: LobbyPlayer[];
  subscribers: number;
  spectators: number;
  host?: string | null;
  createdUnixMs?: number;
};

type LobbyStatus = {
  instances: LobbyInstance[];
};

type LobbyJoinResult = {
  instance: LobbyStatus;
  role: {
    kind: LobbyRole;
    player?: number | null;
  };
};

type LobbyStartResult = {
  instance: LobbyStatus;
  id: string;
};

type AlertOpenRaStatus = {
  running: boolean;
  exited?: boolean;
  code?: number | null;
  instance?: string | null;
  port?: number;
  startedUnixMs?: number;
  runtimePath?: string;
  supportDir?: string;
  touchBridgeFile?: string;
  display?: string;
  captureWidth?: number;
  captureHeight?: number;
  streamPath?: string;
  touchBridge?: {
    running?: boolean;
    configured?: boolean;
    exited?: boolean;
    code?: number | null;
    command?: string;
  };
  client?: AlertOpenRaStatus;
};

type DoomCommand = {
  tic: number;
  forward: number;
  strafe: number;
  turn: number;
  buttons: number;
  weapon: number;
};

type DoomFrame = {
  tic: number;
  commands: DoomCommand[];
};

type DoomServerEvent =
  | { id: number; type: "playerJoined"; player: number; user: string }
  | { id: number; type: "playerClaimed"; player: number; user: string }
  | { id: number; type: "playerReady"; player: number; ready: boolean }
  | { id: number; type: "playerHeartbeat"; player: number }
  | { id: number; type: "playerLeft"; player: number }
  | { id: number; type: "ticFrame"; tic: number; commands: DoomCommand[] }
  | { id: number; type: "reset" };

type DoomEventsResult = {
  instance: string;
  lastEventId: number;
  events: DoomServerEvent[];
};

type DoomPlayer = {
  player: number;
  user: string;
  ready: boolean;
};

type DoomStatus = {
  instance: string;
  name: string;
  currentTic: number;
  replayEvents?: number;
  lastEventId?: number;
  players: DoomPlayer[];
  frames: DoomFrame[];
};

type HostUserSummary = {
  name: string;
  banned: boolean;
  admin: boolean;
  permissions: HostPermissions;
};

type HostUserList = {
  users: HostUserSummary[];
};

type HostPermissions = {
  canPlay: boolean;
  canLaunchRoms: boolean;
  canUploadRoms: boolean;
  canManageLibrary: boolean;
  canAwardEutherium: boolean;
};

type AuthStatus = {
  authenticated: boolean;
  user?: string;
  isAdmin?: boolean;
  permissions?: HostPermissions;
  csrfToken?: string | null;
};

type UserPreferences = {
  audioVolume: number;
  micVolume: number;
  doomMouseSensitivity: number;
  theme?: UserTheme;
  skin?: UserSkin;
  eutherbooksVoice?: string;
  eutherbooksCustomVoice?: string;
  eutherbooksLengthScale?: number;
  eutherbooksNoiseScale?: number;
  eutherbooksNoiseW?: number;
  eutherbooksSentenceSilence?: number;
  eutherbooksCfgValue?: number;
  eutherbooksInferenceTimesteps?: number;
  eutherbooksMaxChunkChars?: number;
  eutherbooksSeed?: number;
  eutherbooksModelBackend?: string;
  eutherbooksDotsGuidanceScale?: number;
  eutherbooksDotsSpeakerScale?: number;
  eutherbooksDotsNumSteps?: number;
  eutherbooksDotsMaxGenerateLength?: number;
  eutherbooksLastBookId?: string;
  eutherbooksLastChapterIndex?: number;
  eutherbooksAutoGenerateNext?: boolean;
  eutherbooksOwnVoiceSvPath?: string;
  eutherbooksOwnVoiceSvPrompt?: string;
  eutherbooksOwnVoiceSvLocked?: boolean;
  eutherbooksOwnVoiceEnPath?: string;
  eutherbooksOwnVoiceEnPrompt?: string;
  eutherbooksOwnVoiceEnLocked?: boolean;
};

type UserTheme = "dark" | "light" | "royal-apothic";
type UserSkin = "classic" | "glass" | "arcade" | "custom";

type ChatMessage = {
  id: number;
  user: string;
  message: string;
  createdUnixMs: number;
};

type ChatResult = {
  messages: ChatMessage[];
};

type VideoChatParticipant = {
  clientId: string;
  user: string;
  canSend: boolean;
  updatedUnixMs: number;
};

type VideoChatSignalType = "offer" | "answer";

type VideoChatSignal = {
  id: number;
  from: string;
  to: string;
  type: VideoChatSignalType;
  sdp: string;
  createdUnixMs: number;
};

type VideoChatResult = {
  self: string;
  participants: VideoChatParticipant[];
  signals: VideoChatSignal[];
};

type PlayMode = "megadrive" | "eutherdogs" | "euthercivet" | "eutheralert" | "eutherdoom" | "eutherduke";
type AppRoute = "playHome" | PlayMode | "interactionLobby";
type WorkspaceWindow = "interaction" | "shopping" | "eutherium" | "books" | "friends" | "spaces" | "profile" | "settings";

type InteractionFriend = {
  name: string;
  status: "Online" | "Offline";
  location: string;
  online?: boolean;
  isCurrentUser?: boolean;
};

type InteractionUsersResult = {
  currentUser: string;
  users: InteractionFriend[];
};

type SocialChatUser = {
  name: string;
  displayName: string;
  online: boolean;
  status: "Online" | "Offline";
  location: string;
  special?: "codex";
};

type SocialChatConversationKind = "direct" | "group";

type SocialChatMessagePreview = {
  user: string;
  text: string;
  createdUnixMs: number;
};

type SocialChatAttachment = {
  id: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  url: string;
};

type SocialChatReaction = {
  key: string;
  users: string[];
};

type SocialChatConversation = {
  id: string;
  kind: SocialChatConversationKind;
  title?: string | null;
  participants: string[];
  createdBy: string;
  createdUnixMs: number;
  updatedUnixMs: number;
  lastMessage?: SocialChatMessagePreview | null;
};

type SocialChatMessage = {
  id: number;
  conversationId: string;
  user: string;
  text: string;
  attachments?: SocialChatAttachment[];
  reactions?: SocialChatReaction[];
  createdUnixMs: number;
};

type SocialChatUsersResult = {
  users: SocialChatUser[];
};

type SocialChatConversationsResult = {
  conversations: SocialChatConversation[];
};

type SocialChatConversationResult = {
  conversation: SocialChatConversation;
};

type SocialChatMessagesResult = {
  conversation: SocialChatConversation;
  messages: SocialChatMessage[];
  hasOlder: boolean;
};

type SocialChatPostResult = {
  conversation: SocialChatConversation;
  message: SocialChatMessage;
};

type SocialChatAttachmentResult = {
  attachment: SocialChatAttachment;
};

type SocialChatReactionResult = {
  conversation: SocialChatConversation;
  message: SocialChatMessage;
};

type InteractionSpace = {
  name: string;
  detail: string;
};

type InteractionInvite = {
  text: string;
  kind: string;
};

type FutureModule = {
  name: string;
  detail: string;
};

type ShoppingListRole = "owner" | "edit" | "view";

type ShoppingListMember = {
  name: string;
  role: ShoppingListRole;
  isCurrentUser?: boolean;
};

type ShoppingListResult = {
  name: string;
  sharedId: string;
  markdown: string;
  members?: Array<string | ShoppingListMember>;
  role?: ShoppingListRole;
  canEdit?: boolean;
  canManage?: boolean;
  updatedUnixMs?: number | null;
};

type ShoppingListItem = {
  lineIndex: number;
  checked: boolean;
  text: string;
  category: string;
};

type ShoppingListCategoryGroup = {
  name: string;
  items: ShoppingListItem[];
};

type EutherBook = {
  id: string;
  title: string;
  author: string | null;
  format: string;
  path: string;
  size_bytes: number;
  modified_at: number;
};

type EutherBookChapter = {
  index: number;
  title: string;
  char_count: number;
};

type EutherBooksJob = {
  id: string;
  book_id: string;
  status: "queued" | "running" | "done" | "failed" | string;
  language: string;
  voice: string;
  chapter_indexes: number[];
  owner?: string;
  audio_files: string[];
  audio_durations?: number[];
  total_audio_files?: number;
  tts_options?: Record<string, number | string | boolean | null>;
  queue_remainder?: boolean;
  progress_label?: string;
  progress_detail?: string;
  current_chapter_index?: number | null;
  current_chunk_index?: number;
  worker_progress?: number;
  total_chunks?: number;
  error: string | null;
};

type EutherBooksBookmark = {
  book_id: string;
  chapter_index: number;
  audio_index: number;
  audio_path: string;
  current_time: number;
  duration: number | null;
  updated_at: number;
};

type EutherBooksModelBackend = "voxcpm2" | "dots.tts-soar" | "dots.tts-mf";

type EutherBooksVoice = {
  id: string;
  label: string;
  language: string;
  backend: string;
  path: string;
  model_backend?: string | null;
  default_length_scale?: number | null;
  default_seed?: number | null;
};

type EutherBooksModelHealth = {
  ok?: boolean;
  status?: string;
  model_loaded?: boolean;
  loaded_model?: string | null;
  precision?: string | null;
  max_generate_length?: number | null;
};

type EutherBooksHealth = {
  status: string;
  tts_backend: string;
  dots_tts?: EutherBooksModelHealth | null;
};

type EutherBooksSleepTimerMode = "off" | "5" | "10" | "15" | "30" | "45" | "60" | "chapter";

type EutherBooksPlaybackState =
  | "idle"
  | "loading"
  | "buffering"
  | "playing"
  | "paused"
  | "ended"
  | "error";

type EutherBooksPlaybackTimeline = {
  current: number;
  total: number;
  generatedUntil: number;
  scheduledUntil: number;
  bufferAhead: number;
  readyAudioFiles: number;
  totalAudioFiles: number;
  isComplete: boolean;
  isWebAudio: boolean;
};

type EutheriumShopItem = {
  id: string;
  name: string;
  itemType: string;
  price: number;
  description: string;
  imagePath: string;
  rarity: string;
};

type EutheriumLedgerEntry = {
  id: string;
  userId: string;
  amount: number;
  reason: string;
  source: string;
  createdByUserId: string;
  createdUnixMs: number;
};

type EutheriumInventoryEntry = {
  id: string;
  userId: string;
  itemId: string;
  acquiredUnixMs: number;
  equippedToItemId?: string | null;
  item?: EutheriumShopItem | null;
};

type TrophyRoomLayoutItem = {
  inventoryId: string;
  x: number;
  y: number;
  scale: number;
};

type TrophyRoomLayout = {
  background: string;
  items: TrophyRoomLayoutItem[];
};

type TrophyRoomResult = {
  user: string;
  layout: TrophyRoomLayout;
  inventory: EutheriumInventoryEntry[];
};

type EutheriumMeResult = {
  user: string;
  isAdmin: boolean;
  balance: number;
  ledger: EutheriumLedgerEntry[];
  inventory: EutheriumInventoryEntry[];
  items: EutheriumShopItem[];
  trophyRoom: TrophyRoomResult;
};

type EutheriumAdminResult = {
  users: Array<{ user: string; admin: boolean; balance: number }>;
  ledger: EutheriumLedgerEntry[];
};

type EutheriumActivityResult = {
  user: string;
  balance: number;
  awards: EutheriumLedgerEntry[];
};

type PadBinding = {
  kind: "button" | "axis";
  code: string;
  direction?: "positive" | "negative";
};

type ControlBinding = {
  key: string;
  pad: PadBinding;
};

type PadControl = {
  id: string;
  label: string;
  pressed: boolean;
  value?: number;
  kind: "button" | "axis";
  direction?: "positive" | "negative";
};

type GamepadDevice = {
  id: string;
  name: string;
  controls: PadControl[];
};

type GamepadSnapshot = {
  available: boolean;
  error?: string | null;
  gamepads: GamepadDevice[];
};

type RomDirSetting = {
  romDir?: string | null;
};

type RomDirEntry = {
  name: string;
  path: string;
  isDir: boolean;
};

type RomDirListing = {
  romDir?: string | null;
  path: string;
  parent?: string | null;
  entries: RomDirEntry[];
};

type ShaderParamName =
  | "scanlines"
  | "phosphor_glow"
  | "rgb_mask"
  | "vignette"
  | "curvature"
  | "noise"
  | "chroma_bleed"
  | "luma_sharpness"
  | "dither_blend"
  | "dot_crawl"
  | "rf_noise"
  | "bloom"
  | "highlight_glow"
  | "contrast_curve"
  | "saturation"
  | "glass_shimmer";

type ShaderParams = Record<ShaderParamName, number>;

type ShaderConfig = {
  selected: string;
  available: string[];
  presets: Record<string, ShaderParams>;
};

type StateSlot = {
  slot: number;
  occupied: boolean;
  createdUnixMs?: number | null;
  frameCount?: number | null;
  label?: string | null;
};

type StateSlotsResult = {
  path?: string | null;
  slots: StateSlot[];
};

type LoadStateResult = {
  frame: FrameResult;
  states: StateSlotsResult;
};

type WebStateSnapshot = {
  frame: number;
  cpuCycles: number;
  cpuSteps: number;
  frameMs: number;
  status: string;
};

type CachedRomRecord = {
  key: "last";
  name: string;
  bytes: ArrayBuffer;
  hash: number;
  savedUnixMs: number;
};

type UiState = LoadResult & {
  loaded: boolean;
  playing: boolean;
  runtime: "tauri" | "web" | "bridge";
  frame: number;
  cpuCycles: number;
  cpuSteps: number;
  frameMs: number;
  transportMs: number;
  drawMs: number;
  audioLeadMs: number;
  transportMode: string;
  rtcLeaseStatus: string;
  inputStatus: string;
  videoAgeStatus: string;
  status: string;
  lastError: string;
  stateSlots: StateSlot[];
  nativeStates: boolean;
  build: BridgeBuildStatus;
};

type DogsCoreActor = {
  id: number;
  faction: "player" | "hostile_customer" | string;
  x: number;
  y: number;
  direction: string;
  sprite?: string;
  armor: number;
  lives: number;
  alive: boolean;
  activeWeapon: string;
  ammo: number;
};

type DogsCoreBullet = {
  id: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  ownerFaction: "player" | "hostile_customer" | string;
  weapon: string;
};

type DogsProjectileStyle = {
  asset: string;
  color: string;
  size: number;
  trail: number;
  glow: number;
  impact: number;
  spins?: boolean;
};

type DogsImpactEffect = {
  id: string;
  x: number;
  y: number;
  weapon: string;
  ownerFaction: string;
  startFrame: number;
};

type DogsCoreSummary = {
  mission: number;
  maxMission: number;
  status: "running" | "won" | "lost" | string;
  elapsedTicks: number;
  score: number;
  cash: number;
  kills: number;
  targetsDestroyed: number;
  objectsCollected: number;
  shotsFired: number;
  hits: number;
  damageTaken: number;
  targetsLeft: number;
  objectsLeft: number;
  minimumKills: number;
  timeRemainingTicks?: number | null;
  bossActive?: boolean;
  bossName?: string | null;
  bossArmor?: number | null;
  bossMaxArmor?: number | null;
  routineRead?: number;
  routineTotal?: number;
  inspectionAnswers?: number;
  inspectionProtocol?: number;
};

type DogsStoreItem = {
  id: string;
  label: string;
  price: number;
  detail: string;
  weapon?: string | null;
  ammo: number;
  armor: number;
  owned: boolean;
  currentAmmo?: number | null;
  active: boolean;
  affordable: boolean;
};

type DogsCoreFrame = {
  frame: number;
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  characterWidth: number;
  characterHeight: number;
  tiles: string[];
  visibility: number[];
  characters: DogsCoreActor[];
  bullets: DogsCoreBullet[];
  inspectionDialogues?: DogsInspectionDialogue[];
  summary: DogsCoreSummary;
  store: DogsStoreItem[];
  audioEvents?: string[];
  highscoreCount: number;
  ackedInputSeq?: number;
};

type DogsInspectionDialogue = {
  player: number;
  inspectorId: number;
  question: string;
  complete: boolean;
};

type DogsStreamFrame = Partial<DogsCoreFrame> & Pick<DogsCoreFrame, "frame">;

type DogsCompactStreamFrame = Partial<DogsCoreFrame> & {
  frame: number;
  compact?: 1;
  c?: unknown[];
  b?: unknown[];
  ac?: unknown[];
  ar?: unknown[];
  bc?: unknown[];
  br?: unknown[];
  d?: unknown[];
  s?: unknown[];
  a?: string[];
  h?: number;
  q?: number;
};

type DogsHighScoreEntry = {
  id: string;
  name: string;
  score: number;
  cash: number;
  mission: number;
  kills: number;
  targetsDestroyed: number;
  objectsCollected: number;
  elapsedTicks: number;
  completed: boolean;
  staff: string;
  createdAt: string;
};

type DogsMenuMode = "staff" | "store" | "briefing" | "scores" | "result" | null;
type DogsActorFacing = "down" | "left" | "right" | "up";

type DogsStaffOption = {
  id: 1 | 2;
  character: DogsCharacterKey;
  name: string;
  role: string;
  armor: number;
  cash: number;
  loadout: string;
  note: string;
};

const isTauri = Boolean(window.__TAURI_INTERNALS__);
document.documentElement.classList.toggle("is-tauri-shell", isTauri);
const pageParams = new URLSearchParams(window.location.search);
const explicitBridgeBase = pageParams.get("bridge");
const currentHostname = window.location.hostname.toLowerCase();
const localWebHost = isLocalWebHost(currentHostname);
const hostedServerMode =
  !import.meta.env.DEV && !isTauri && !explicitBridgeBase && !localWebHost && window.location.port !== "5173";
const forceMegaDriveStartup = pageParams.get("megadrive") === "1" || pageParams.get("eutherdogs") === "0";
const autoStartEutherDogs = pageParams.get("eutherdogs") === "1";
const bridgeBase =
  explicitBridgeBase ??
  (hostedServerMode || (window.location.port && window.location.port !== "5173")
    ? window.location.origin
    : "http://127.0.0.1:32161");
const defaultEutherBooksHost = localWebHost ? "127.0.0.1" : window.location.hostname;
const hostedEutherBooksBase =
  hostedServerMode || (window.location.port && window.location.port !== "5173")
    ? "/eutherbooks"
    : explicitBridgeBase
      ? new URL("/eutherbooks", bridgeBase).toString()
      : `${window.location.protocol}//${defaultEutherBooksHost}:8088`;
const eutherBooksBase = (
  pageParams.get("books") ??
  import.meta.env.VITE_EUTHERBOOKS_BASE ??
  hostedEutherBooksBase
).replace(/\/$/, "");
const eutherBooksUsesHostProxy = isEutherBooksHostProxyBase(eutherBooksBase);
const eutherDogsAssets = parseEutherDogsManifest(eutherDogsManifestToml, eutherDogsAssetModules);
const dogsStaffOptions: DogsStaffOption[] = [
  {
    id: 1,
    character: "night_shift_tech",
    name: "Night Tech",
    role: "Closing shift technician",
    armor: 100,
    cash: 500,
    loadout: "Scanner Blaster, Rx Cannon",
    note: "Knows where the prior-auth forms are buried.",
  },
  {
    id: 2,
    character: "neon_pharmacist",
    name: "Neon Pharmacist",
    role: "Counter lead",
    armor: 100,
    cash: 500,
    loadout: "Scanner Blaster",
    note: "Can say 'policy' without blinking.",
  },
];

function normalizedHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
}

function isLocalWebHost(hostname: string): boolean {
  const host = normalizedHostname(hostname);
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function isPrivateLanHostname(hostname: string): boolean {
  const octets = normalizedHostname(hostname).split(".");
  if (octets.length !== 4) {
    return false;
  }
  const parts = octets.map((part) => Number(part));
  if (parts.some((part, index) => !Number.isInteger(part) || part < 0 || part > 255 || octets[index] !== String(part))) {
    return false;
  }
  return (
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 169 && parts[1] === 254)
  );
}

function isEutherBooksHostProxyBase(base: string): boolean {
  if (base === "/eutherbooks") {
    return true;
  }
  try {
    return new URL(base, window.location.origin).pathname.replace(/\/$/, "") === "/eutherbooks";
  } catch (_err) {
    return false;
  }
}

const romCacheDb = "eutheroxide-rom-cache";
const romCacheStore = "roms";
const volumeStorageKey = "eutheroxide-audio-volume";
const micVolumeStorageKey = "eutheroxide-mic-volume";
const bindingsStorageKey = "eutheroxide-input-bindings";
const dogsBindingsStorageKey = "eutheroxide-eutherdogs-input-bindings";
const shaderStorageKey = "eutheroxide-video-shader";
const shaderConfigStorageKey = "eutheroxide-video-shader-toml";
const mobileModeStorageKey = "eutheroxide-mobile-mode";
const dogsAssetModeStorageKey = "eutheroxide-eutherdogs-asset-mode";
const dogsCharactersStorageKey = "eutheroxide-eutherdogs-characters";
const bridgeClientStorageKey = "eutheroxide-bridge-client-id";
const playerPortStorageKey = "eutheroxide-player-port";
const doomMouseSensitivityStorageKey = "eutheroxide-eutherdoom-mouse-sensitivity";
const userThemeStorageKey = "eutheroxide-user-theme";
const userSkinStorageKey = "eutheroxide-user-skin";
const customSkinCssStorageKey = "eutheroxide-custom-skin-css";
const dogsHighScoresStorageKey = "eutheroxide-eutherdogs-highscores";
const dogsHighScoreLimit = 10;
const dogsAudioPreloadTimeoutMs = 12000;
let audioVolume = readStoredVolume();
let micVolume = readStoredMicVolume();
let userTheme: UserTheme = readStoredUserTheme();
let userSkin: UserSkin = readStoredUserSkin();
const localAudioTargetLeadSeconds = 0.055;
const localAudioMinimumLeadSeconds = 0.018;
const localAudioMaximumLeadSeconds = 0.16;
const bridgeAudioTargetLeadSeconds = 0.14;
const bridgeAudioMinimumLeadSeconds = 0.08;
const bridgeAudioMaximumLeadSeconds = 0.65;
const mobileBridgeAudioTargetLeadSeconds = 0.24;
const mobileBridgeAudioMinimumLeadSeconds = 0.16;
const mobileBridgeAudioMaximumLeadSeconds = 1.0;
const eutherDogsCameraWorldWidth = 330;
const eutherDogsCameraWorldHeight = 230;
const eutherDogsRenderYScale = 4 / 3;
const eutherDogsTopHudSafePx = 50;
const eutherDogsBottomHudSafePx = 30;
const eutherDogsTileFallbackColors: Record<string, string> = {
  floor: "#dfe8dc",
  sterile_floor: "#dfe8dc",
  neon_floor: "#2ff7dc",
  warning_floor: "#f7d852",
  fan_floor: "#9fb2aa",
  player_spawn_1: "#39f7c8",
  player_spawn_2: "#ff5de1",
  wall: "#263630",
  door: "#374a42",
  corrupt_med_cabinet: "#ff37c8",
  hacked_vending_unit: "#65716b",
  recall_crate: "#7f6b46",
  shipping_box: "#8b7658",
  service_elevator: "#f7d852",
  prescription: "#39f7c8",
  folder: "#60c5ff",
  data_wafer: "#9c7dff",
  circuit_board: "#39f767",
  pill_sample: "#ffffff",
  lab_coat_armor: "#cfefff",
  hazard_sleeves: "#ffef7a",
  pill_splitter: "#ff9bd9",
  routine_directive: "#ffef7a",
  scorch_mark: "#1b211e",
  spilled_syrup: "#70ffe8",
};
const inputState: InputState = {
  up: false,
  down: false,
  left: false,
  right: false,
  a: false,
  b: false,
  c: false,
  start: false,
};
const keyboardState = emptyInputState();
const pointerState = emptyInputState();
const gamepadState = emptyInputState();
const inputNames: InputName[] = ["up", "down", "left", "right", "a", "b", "c", "start"];
const inputLabels: Record<InputName, string> = {
  up: "D-Pad Up",
  down: "D-Pad Down",
  left: "D-Pad Left",
  right: "D-Pad Right",
  a: "Button A",
  b: "Button B",
  c: "Button C",
  start: "Start",
};
const dogsBindingNames: DogsBindingName[] = [
  "up",
  "down",
  "left",
  "right",
  "a",
  "b",
  "c",
  "start",
  "inventory",
  "map",
  "weapon1",
  "weapon2",
  "weapon3",
  "weapon4",
  "weapon5",
  "answerYes",
  "answerNo",
  "answerOther",
];
const dogsBindingLabels: Record<DogsBindingName, string> = {
  ...inputLabels,
  inventory: "Inventory",
  map: "Map Hold",
  weapon1: "Weapon Slot 1",
  weapon2: "Weapon Slot 2",
  weapon3: "Weapon Slot 3",
  weapon4: "Weapon Slot 4",
  weapon5: "Weapon Slot 5",
  answerYes: "Inspection Yes",
  answerNo: "Inspection No",
  answerOther: "Inspection Other",
};
const defaultBindings: Record<InputName, ControlBinding> = {
  up: { key: "ArrowUp", pad: { kind: "button", code: "DPadUp" } },
  down: { key: "ArrowDown", pad: { kind: "button", code: "DPadDown" } },
  left: { key: "ArrowLeft", pad: { kind: "button", code: "DPadLeft" } },
  right: { key: "ArrowRight", pad: { kind: "button", code: "DPadRight" } },
  a: { key: "z", pad: { kind: "button", code: "South" } },
  b: { key: "x", pad: { kind: "button", code: "East" } },
  c: { key: "c", pad: { kind: "button", code: "RightTrigger" } },
  start: { key: "Enter", pad: { kind: "button", code: "Start" } },
};
const defaultDogsBindings: Record<DogsBindingName, ControlBinding> = {
  ...defaultBindings,
  inventory: { key: "q", pad: { kind: "button", code: "Select" } },
  map: { key: "Shift", pad: { kind: "button", code: "LeftTrigger" } },
  weapon1: { key: "1", pad: { kind: "button", code: "North" } },
  weapon2: { key: "2", pad: { kind: "button", code: "LeftTrigger2" } },
  weapon3: { key: "3", pad: { kind: "button", code: "RightTrigger2" } },
  weapon4: { key: "4", pad: { kind: "button", code: "LeftThumb" } },
  weapon5: { key: "5", pad: { kind: "button", code: "RightThumb" } },
  answerYes: { key: "y", pad: { kind: "button", code: "South" } },
  answerNo: { key: "n", pad: { kind: "button", code: "East" } },
  answerOther: { key: "o", pad: { kind: "button", code: "West" } },
};
let controlBindings = readStoredBindings();
let dogsControlBindings = readStoredDogsBindings();
const shaderParamNames: ShaderParamName[] = [
  "scanlines",
  "phosphor_glow",
  "rgb_mask",
  "vignette",
  "curvature",
  "noise",
  "chroma_bleed",
  "luma_sharpness",
  "dither_blend",
  "dot_crawl",
  "rf_noise",
  "bloom",
  "highlight_glow",
  "contrast_curve",
  "saturation",
  "glass_shimmer",
];
const shaderParamLabels: Record<ShaderParamName, string> = {
  scanlines: "Scanlines",
  phosphor_glow: "Phosphor",
  rgb_mask: "RGB Mask",
  vignette: "Vignette",
  curvature: "Curvature",
  noise: "Noise",
  chroma_bleed: "Chroma",
  luma_sharpness: "Luma Sharp",
  dither_blend: "Dither",
  dot_crawl: "Dot Crawl",
  rf_noise: "RF Noise",
  bloom: "Bloom",
  highlight_glow: "Highlight",
  contrast_curve: "Contrast",
  saturation: "Saturation",
  glass_shimmer: "Glass",
};
let shaderConfig = parseShaderConfig(readStoredShaderConfigSource());
let selectedShader = readStoredShader(shaderConfig);
let activeShaderParams = cloneShaderParams(shaderConfig.presets[selectedShader]);

const ui: UiState = {
  loaded: false,
  playing: false,
  runtime: isTauri ? "tauri" : "web",
  title: "No ROM",
  region: "AUTO",
  timing: "NTSC",
  resetPc: 0,
  width: 320,
  height: 224,
  frame: 0,
  cpuCycles: 0,
  cpuSteps: 0,
  frameMs: 0,
  transportMs: 0,
  drawMs: 0,
  audioLeadMs: 0,
  transportMode: isTauri ? "TAURI INIT" : "WEB INIT",
  rtcLeaseStatus: "idle",
  inputStatus: "idle",
  videoAgeStatus: "idle",
  status: "IDLE",
  lastError: "",
  statePath: null,
  stateSlots: emptySlots(),
  nativeStates: false,
  build: emptyBuildStatus(),
};

let romBytes = new Uint8Array(0) as Uint8Array<ArrayBuffer>;
let romDisplayName = "reaction.argon";
let romHash = 0xC0FFEE;
let romDirRoot: string | null = null;
let romDirPath = "";
let romDirEntries: RomDirEntry[] = [];
let webStateSlots: Array<WebStateSnapshot | null> = [null, null, null];
let stepping = false;
let shaderRenderer: ShaderRenderer | null = null;
let nativeStatusPolling = false;
let videoCanvas: HTMLCanvasElement;
let videoContext: CanvasRenderingContext2D;
let shaderCanvas: HTMLCanvasElement;
let dogsCanvas: HTMLCanvasElement;
let dogsContext: CanvasRenderingContext2D;
let lastInputJson = JSON.stringify(inputState);
let lastBrowserFile: File | null = null;
let bridgeRetryTimer: number | null = null;
let buildPollTimer: number | null = null;
let bridgeStreamAbort: AbortController | null = null;
let bridgeStreamActive = false;
let bridgeStreamGeneration = 0;
let bridgeVideoActive = false;
let bridgeVideoFallbackTimer: number | null = null;
let bridgeVideoAbort: AbortController | null = null;
let bridgeVideoLatencyTimer: number | null = null;
let bridgeWebRtcPeer: RTCPeerConnection | null = null;
let bridgeWebRtcChannel: RTCDataChannel | null = null;
let bridgeWebRtcHeartbeatTimer: number | null = null;
let bridgeWebRtcInputTimer: number | null = null;
let bridgeWebRtcStatsTimer: number | null = null;
let bridgeWebRtcInputSeq = 0;
let bridgeWebRtcGeneration = 0;
let bridgeWebRtcActive = false;
let bridgeWebRtcVideoActive = false;
let bridgeWebRtcAudioActive = false;
let bridgeWebRtcMode: "idle" | "connecting" | "active" | "blocked" | "failed" = "idle";
let bridgeWebRtcLastPingAt = 0;
let bridgeWebRtcLastPongAt = 0;
let bridgeWebRtcLastVideoStats: {
  emitted: number;
  jitter: number;
  decoded: number;
  decode: number;
  dropped: number;
  received: number;
  checkedAt: number;
} | null = null;
let bridgeRestarting = false;
let bridgeReconnectToken = 0;
let bridgePlaybackStarting = false;
let nativeBridgeBase: string | null = null;
const bridgeClientId = readBridgeClientId();
let playerPort: PlayerPort = readStoredPlayerPort();
let lobbyRole: LobbyRole = "player";
let activeLobbyInstanceId = "main";
let claimedLobbyPlayer: PlayerPort | null = null;
let eutherAlertVesselEnsurePromise: Promise<boolean> | null = null;
let eutherAlertRendererStartToken = 0;
let hostUsername: string | null = null;
let hostIsAdmin = false;
let hostCsrfToken: string | null = null;
let userPreferencesLoadedFor: string | null = null;
let userPreferencesLoadingFor: string | null = null;
let applyingUserPreferences = false;
let userPreferencesSaveTimer: number | null = null;
let appRoute: AppRoute = "playHome";
let activeWorkspaceWindow: WorkspaceWindow | null = null;
let userMenuOpen = false;
let hostPermissions: HostPermissions = {
  canPlay: false,
  canLaunchRoms: false,
  canUploadRoms: false,
  canManageLibrary: false,
  canAwardEutherium: false,
};
let lobbyStatus: LobbyStatus | null = null;
let doomStatus: DoomStatus | null = null;
let doomDriveTimer: number | null = null;
let doomDriveInFlight = false;
let doomDriveSubmitted = 0;
let doomEventPollTimer: number | null = null;
let doomEventStream: EventSource | null = null;
let doomLastEventId = 0;
let doomRendererStarted = false;
let doomRendererController: { stop?: () => Promise<void>; setMouseSensitivity?: (value: number) => void } | null = null;
let doomRuntimeScriptPromise: Promise<void> | null = null;
let doomMouseSensitivity = readStoredDoomMouseSensitivity();
let civetMode = false;
let hostUsers: HostUserSummary[] = [];
let selectedAdminUser: string | null = null;
let chatMessages: ChatMessage[] = [];
let chatPollTimer: number | null = null;
let shoppingListName = "shopping-list.md";
let shoppingListSharedId = "hemmet";
let shoppingListMarkdown = defaultShoppingListMarkdown();
let shoppingListLoaded = false;
let shoppingListSaving = false;
let shoppingListStatus = "Not loaded";
let shoppingListSaveTimer: number | null = null;
let shoppingListMembers: ShoppingListMember[] = [];
let shoppingListRole: ShoppingListRole = "owner";
let shoppingListCanEdit = true;
let shoppingListCanManage = true;
let shoppingListSharing = false;
let shoppingListShareStatus = "Not shared";
let eutherBooksLoaded = false;
let eutherBooksLoading = false;
let eutherBooksStatus = "Not loaded";
let eutherBooksHealth: EutherBooksHealth | null = null;
let eutherBooksHealthLoading = false;
let eutherBooksHealthPollTimer: number | null = null;
let eutherBooks: EutherBook[] = [];
let eutherBooksVoices: EutherBooksVoice[] = [];
let selectedEutherBookId: string | null = localStorage.getItem("eutherbooks-last-book") || null;
let selectedEutherBookChapters: EutherBookChapter[] = [];
let selectedEutherBookChaptersLoading = false;
let selectedEutherBookChapterIndex = storedEutherBooksNumber("last_chapter", 0);
let selectedEutherBooksVoice = localStorage.getItem("eutherbooks-voice") ?? "sv-female-warm";
let selectedEutherBooksModelBackend = normalizeEutherBooksModelBackend(localStorage.getItem("eutherbooks-model") ?? "");
let eutherBooksVoiceSettingsOpen = !window.matchMedia("(max-width: 720px)").matches;
const eutherBooksOwnVoiceSvPromptLegacy = "Det här är min egen berättarröst för ljudböcker. Jag talar tydligt och lugnt så systemet kan lära sig min röst.";
const eutherBooksOwnVoiceEnPromptLegacy = "This is my own audiobook narrator voice. I speak clearly and calmly so the system can learn my tone.";
const eutherBooksOwnVoiceSvPromptDefault = "Solen går långsamt upp över skogen, och rummet fylls av ett mjukt morgonljus. Jag läser den här texten med min naturliga berättarröst, tydligt och lugnt, med små pauser mellan meningarna. Rösten ska låta avslappnad, jämn och lätt att följa.";
const eutherBooksOwnVoiceEnPromptDefault = "The morning light moves slowly across the room. I read this passage in my natural audiobook voice, with clear English pronunciation, steady pacing, and relaxed emphasis. Each sentence should sound calm, consistent, and easy to understand.";
let eutherBooksCustomVoicePrompt = localStorage.getItem("eutherbooks-custom-voice") ?? "A warm Swedish audiobook narrator with clear pronunciation and natural pacing.";
let eutherBooksOwnVoiceSvPath = localStorage.getItem("eutherbooks-own-sv-path") ?? "";
let eutherBooksOwnVoiceSvPrompt = normalizeEutherBooksOwnVoicePrompt("sv", localStorage.getItem("eutherbooks-own-sv-prompt"));
let eutherBooksOwnVoiceSvLocked = localStorage.getItem("eutherbooks-own-sv-locked") === "true";
let eutherBooksOwnVoiceEnPath = localStorage.getItem("eutherbooks-own-en-path") ?? "";
let eutherBooksOwnVoiceEnPrompt = normalizeEutherBooksOwnVoicePrompt("en", localStorage.getItem("eutherbooks-own-en-prompt"));
let eutherBooksOwnVoiceEnLocked = localStorage.getItem("eutherbooks-own-en-locked") === "true";
let eutherBooksVoiceRecorder: MediaRecorder | null = null;
let eutherBooksVoiceRecordCancelled = false;
let eutherBooksVoiceSampleDialogOpen = false;
let eutherBooksVoiceRecordChunks: Blob[] = [];
let eutherBooksVoiceSampleBlob: Blob | null = null;
let eutherBooksVoiceSampleUrl = "";
let eutherBooksVoiceSampleStatus = "";
let eutherBooksLengthScale = storedEutherBooksNumber("length_scale", 1);
let eutherBooksNoiseScale = storedEutherBooksNumber("noise_scale", 0.667);
let eutherBooksNoiseW = storedEutherBooksNumber("noise_w", 0.8);
let eutherBooksSentenceSilence = storedEutherBooksNumber("sentence_silence", 0.2);
let eutherBooksCfgValue = storedEutherBooksNumber("cfg_value", 2);
let eutherBooksInferenceTimesteps = storedEutherBooksNumber("inference_timesteps", 10);
let eutherBooksDotsGuidanceScale = 1.2;
let eutherBooksDotsSpeakerScale = 1.5;
let eutherBooksDotsNumSteps = 4;
const eutherBooksDotsMaxGenerateLength = 500;
let eutherBooksMaxChunkChars = storedEutherBooksNumber("max_chunk_chars", 700);
let eutherBooksSeed = storedEutherBooksNumber("seed", 0);
let eutherBooksJob: EutherBooksJob | null = null;
let eutherBooksJobPollTimer: number | null = null;
let eutherBooksTtsSubmitting = false;
let eutherBooksAudioIndex = 0;
let eutherBooksAutoAdvance = localStorage.getItem("eutherbooks-auto-advance") !== "false";
let eutherBooksAutoGenerateNext = localStorage.getItem("eutherbooks-auto-generate-next") !== "false";
let eutherBooksPendingAutoplayJobId: string | null = null;
let eutherBooksBufferedAutoplayJobId: string | null = null;
let eutherBooksBufferedResumeSeconds = 0;
let eutherBooksBufferedAudioCount = 0;
let eutherBooksPrefetchJobs: EutherBooksJob[] = [];
let eutherBooksPrefetchPollTimer: number | null = null;
let eutherBooksPrefetchCheckAt = 0;
let eutherBooksPlayerStatus = "";
let eutherBooksPlaybackState: EutherBooksPlaybackState = "idle";
let eutherBooksJobLastCheckedAt = 0;
let eutherBooksPlayableFallbackJob: EutherBooksJob | null = null;
let eutherBooksAudioRenderToken = 0;
let eutherBooksPlaybackSessionCounter = 0;
let eutherBooksPlaybackDebugOpen = localStorage.getItem("eutherbooks-playback-debug") === "true";
let eutherBooksVoicePickerScrollTop = 0;
const eutherBooksAudioDurationCache = new Map<string, number>();
const eutherBooksWebAudioChunkCache = new Map<string, Promise<EutherBooksDecodedAudioChunk>>();
let eutherBooksWebAudioState: EutherBooksWebAudioState | null = null;
const EUTHERBOOKS_WEB_AUDIO_CROSSFADE_SECONDS = 0.055;
const EUTHERBOOKS_WEB_AUDIO_SCHEDULE_AHEAD_SECONDS = 35;
const EUTHERBOOKS_AUTOPLAY_START_BUFFER_SECONDS = 30;
const EUTHERBOOKS_AUTOPLAY_RESUME_BUFFER_SECONDS = 12;
const EUTHERBOOKS_AUTOPLAY_MIN_START_PARTS = 2;
const EUTHERBOOKS_AUTOPLAY_UNDERRUN_GUARD_SECONDS = 3;
const EUTHERBOOKS_NEXT_CHAPTER_PREFETCH_SECONDS = 240;
const EUTHERBOOKS_NEXT_CHAPTER_PREFETCH_FRACTION = 0.35;
let eutherBooksSleepTimerMode: EutherBooksSleepTimerMode = "off";
let eutherBooksSleepTimerDeadline: number | null = null;
let eutherBooksSleepTimerId: number | null = null;
let interactionUsers: InteractionFriend[] = [];
let interactionUsersLoaded = false;
let interactionUsersStatus = "Mock users";
let socialChatConversations: SocialChatConversation[] = [];
let socialChatMessages: SocialChatMessage[] = [];
let socialChatUsers: SocialChatUser[] = [];
let socialChatSelectedConversationId: string | null = null;
let socialChatSelectedUsers = new Set<string>();
let socialChatSearchQuery = "";
let socialChatStatus = "Not loaded";
let socialChatLoading = false;
let socialChatHasOlder = false;
let socialChatPendingAttachments: SocialChatAttachment[] = [];
let socialChatUploading = false;
let socialChatSidebarCollapsed = window.matchMedia("(max-width: 640px)").matches;
let socialChatEmojiPickerOpen = false;
let socialChatThreadDetailsExpanded = false;
let socialChatRefreshInFlight = false;
let socialChatLastRefreshAt = 0;
let socialChatPullStartY: number | null = null;
let socialChatPullTriggered = false;
let eutheriumLoaded = false;
let eutheriumSaving = false;
let eutheriumStatus = "Not loaded";
let eutheriumMe: EutheriumMeResult | null = null;
let eutheriumAdmin: EutheriumAdminResult | null = null;
let eutheriumLobbyStatus = "Not loaded";
let eutheriumLobbyBalance: number | null = null;
let eutheriumLobbyAwards: EutheriumLedgerEntry[] = [];
let selectedTrophyInventoryId: string | null = null;
let trophyDrag: {
  inventoryId: string;
  pointerId: number;
  startX: number;
  startY: number;
  startItemX: number;
  startItemY: number;
  layout: TrophyRoomLayout;
} | null = null;
let videoChatJoined = false;
let videoChatSending = false;
let videoChatMuted = false;
let videoChatParticipants: VideoChatParticipant[] = [];
let videoChatPollTimer: number | null = null;
let videoChatLastSignalId = 0;
let videoChatStatusMessage = "idle";
let videoChatRawLocalStream: MediaStream | null = null;
let videoChatLocalStream: MediaStream | null = null;
let videoChatMicContext: AudioContext | null = null;
let videoChatMicGain: GainNode | null = null;
const videoChatPeers = new Map<string, RTCPeerConnection>();
const videoChatRemoteStreams = new Map<string, MediaStream>();
const videoChatPeerModes = new Map<string, string>();
const videoChatMakingOffer = new Set<string>();
let videoChatRenderKey = "";
let desiredBuildProfile: "debug" | "release" = "debug";
let audioContext: AudioContext | null = null;
let audioGain: GainNode | null = null;
let audioCursor = 0;
const activeAudioSources = new Set<AudioScheduledSourceNode>();
let nextFrameDue = performance.now();
let nativeSurfaceRectTimer: number | null = null;
let controlsOpen = false;
let controlsScope: BindingScope = "global";
let captureTarget: InputName | DogsBindingName | null = null;
let captureMode: "key" | "pad" | null = null;
let gamepadPollTimer: number | null = null;
const dogsGamepadActionState: Record<Exclude<DogsBindingName, InputName>, boolean> = {
  inventory: false,
  map: false,
  weapon1: false,
  weapon2: false,
  weapon3: false,
  weapon4: false,
  weapon5: false,
  answerYes: false,
  answerNo: false,
  answerOther: false,
};
let shaderSaveTimer: number | null = null;
let shaderConfigLoadAttempted = false;
let mobileMode = readStoredMobileMode();
let dogsMode = false;
let dogsFrame: DogsCoreFrame | null = null;
let dogsMenuMode: DogsMenuMode = null;
let dogsAssetMode: DogsAssetMode = readStoredDogsAssetMode();
let selectedDogsStaff: 1 | 2 = 1;
let selectedDogsCharacters: Record<PlayerPort, DogsCharacterKey> = readStoredDogsCharacters();
let selectedDogsMission = 1;
let dogsStorePreviewItemId: string | null = null;
let dogsSubmittedHighscoreFrame: number | null = null;
let dogsHighScoresTomlLoadAttempted = false;
let dogsPendingHighscoreFrame: DogsCoreFrame | null = null;
let dogsHighscoreInitials = ["A", "A", "A"];
let dogsHighscoreInitialIndex = 0;
let dogsHighscoreSavedName: string | null = null;
let dogsSelectedHighScoreIndex = 0;
let dogsScoresReturnMode: Exclude<DogsMenuMode, null> = "briefing";
let dogsInventoryOpen = false;
let dogsMapOpen = false;
const dogsImageCache = new Map<string, HTMLImageElement>();
const dogsImageLoadPromises = new Map<string, Promise<void>>();
const dogsSfxCache = new Map<string, AudioBuffer>();
const dogsMusicCache = new Map<string, AudioBuffer>();
const dogsWarmupCanvas = document.createElement("canvas");
dogsWarmupCanvas.width = 1;
dogsWarmupCanvas.height = 1;
const dogsWarmupContext = dogsWarmupCanvas.getContext("2d", { alpha: true });
let dogsMusicKey: string | null = null;
let dogsMusicSource: AudioBufferSourceNode | null = null;
let dogsMusicGain: GainNode | null = null;
let dogsDeferredImageRedraw = false;
let dogsLastHudMarkup = "";
let dogsPreloadedAssetMode: DogsAssetMode | null = null;
let dogsPreloadedAudioKey: string | null = null;
let dogsPreloadProgress: { loaded: number; total: number; label: string } | null = null;
let dogsPreviousActorPositions = new Map<string, { x: number; y: number }>();
let dogsRenderActorPositions = new Map<string, { x: number; y: number }>();
let dogsLastRenderAt = performance.now();
let dogsActorFacings = new Map<string, DogsActorFacing>();
let dogsLastExitReady = false;
let dogsLastPortalHumFrame = -9999;
let dogsPreviousAudioFrame: DogsCoreFrame | null = null;
let dogsInspectionAlertStartFrame = -1;
let dogsInspectionAlertUntilFrame = -1;
let dogsInspectionAlertTitle = "INSPECTION!!!";
let dogsInspectionAlertSubtitle = "RETAIL COMPLIANCE BREACH";
let dogsSawHostileQueue = false;
let dogsTrackedBullets = new Map<number, DogsCoreBullet>();
let dogsImpactEffects: DogsImpactEffect[] = [];
let dogsLastImpactFrameProcessed = -1;
let dogsInspectionAnswerRects: Array<{
  answer: "yes" | "no" | "other";
  x: number;
  y: number;
  w: number;
  h: number;
}> = [];
let lastDogsInputJson = "";
let lastDogsInputSentAt = 0;
let lastDogsSnapshotAt = 0;
let dogsSnapshotMisses = 0;
let dogsStream: EventSource | null = null;
let lastDogsProcessedFrame = -1;
let dogsInputSeq = 0;
let dogsLastAckedInputSeq = 0;
let dogsFireArmed = true;
let dogsLastLocalShotAt = 0;
let dogsLastLocalShotSound: string | null = null;
let lastGamepadSnapshot: GamepadSnapshot = {
  available: false,
  error: null,
  gamepads: [],
};

const fallbackInteractionFriends: InteractionFriend[] = [
  { name: "Joanna", status: "Online", location: "In Main Reaction Vessel" },
  { name: "Alexander", status: "Offline", location: "Last seen in Hemmet" },
  { name: "Sigrid", status: "Online", location: "Available for chat" },
];
const interactionSpaces: InteractionSpace[] = [
  { name: "Hemmet", detail: "Shared list, notes, house rhythm" },
  { name: "EutherDogs Dev", detail: "Build notes and playtest rooms" },
  { name: "Apothic TECH", detail: "Ops, ideas, documents" },
];
const interactionInvites: InteractionInvite[] = [
  { text: "Joanna invited you to Hemmet", kind: "Space invite" },
  { text: "Alexander sent a friend request", kind: "Friend request" },
];
const interactionFutureModules: FutureModule[] = [
  { name: "Shared Lists", detail: "Linked Markdown lists with shared membership" },
  { name: "Shared Notes", detail: "Small living documents for friends and projects" },
  { name: "Markdown Vaults", detail: "Obsidian-like spaces, synced through the host" },
  { name: "Video Rooms", detail: "Persistent room presets for chat and co-play" },
];
const socialChatEmojis = [
  { key: "thumbs-up", label: "Thumbs up", symbol: "👍" },
  { key: "thumbs-down", label: "Thumbs down", symbol: "👎" },
  { key: "chemist-happy", label: "Happy chemist", symbol: "🧪😄" },
  { key: "chemist-laugh", label: "Lab laugh", symbol: "⚗️😂" },
  { key: "chemist-thinking", label: "Thinking formula", symbol: "🧬🤔" },
  { key: "chemist-shocked", label: "Beaker shock", symbol: "🧫😮" },
  { key: "chemist-suspicious", label: "Suspicious sample", symbol: "🔬🧐" },
  { key: "chemist-boom", label: "Tiny explosion", symbol: "💥🧪" },
  { key: "family-chaos", label: "Family chaos", symbol: "🏠✨" },
  { key: "apk-drop", label: "APK drop", symbol: "📦🤖" },
];
const playModeCards: Array<{
  mode: PlayMode;
  label: string;
  kicker: string;
  detail: string;
  action: string;
}> = [
  {
    mode: "megadrive",
    label: "MegaDrive",
    kicker: "Fast H.264 chamber",
    detail: "ROMs, saves, host rooms, spectate and player slots.",
    action: "Open MegaDrive",
  },
  {
    mode: "eutherdogs",
    label: "EutherDogs",
    kicker: "Night shift arcade",
    detail: "Staff, RX Store, briefing, scores and local play.",
    action: "Open EutherDogs",
  },
  {
    mode: "euthercivet",
    label: "EutherCivet",
    kicker: "Coffee estate sim",
    detail: "Civets, beans, paperwork, suspicion and inspections.",
    action: "Open EutherCivet",
  },
  {
    mode: "eutheralert",
    label: "EutherAlert",
    kicker: "Red Alert vessel",
    detail: "Command and Conquer: Red Alert runtime with shared P1/P2 slots.",
    action: "Open EutherAlert",
  },
  {
    mode: "eutherdoom",
    label: "EutherDoom",
    kicker: "Lockstep relay",
    detail: "Start or join Doom rooms with ready state and replay tools.",
    action: "Open EutherDoom",
  },
  {
    mode: "eutherduke",
    label: "EutherDuke",
    kicker: "Build engine lab",
    detail: "EDuke32/WASM vessel foundation for real client-side Duke.",
    action: "Open EutherDuke",
  },
];
const shoppingCategoryOrder = [
  "Frukt & grönt",
  "Torrvaror",
  "Dryck",
  "Hem & städ",
  "Apotek",
  "Djur",
  "Kyl",
  "Frys",
  "Övrigt",
];
const shoppingCategoryAliases = new Map<string, string>([
  ["bakery", "Torrvaror"],
  ["chilled", "Kyl"],
  ["dairy", "Kyl"],
  ["drinks", "Dryck"],
  ["dry goods", "Torrvaror"],
  ["frozen", "Frys"],
  ["fruit and vegetables", "Frukt & grönt"],
  ["household", "Hem & städ"],
  ["meat and fish", "Kyl"],
  ["other", "Övrigt"],
  ["pantry", "Torrvaror"],
  ["pets", "Djur"],
  ["pharmacy", "Apotek"],
  ["produce", "Frukt & grönt"],
  ["vegetables", "Frukt & grönt"],
]);
const shoppingCategoryKeywords: Array<{ category: string; words: string[] }> = [
  {
    category: "Frukt & grönt",
    words: [
      "apple",
      "avocado",
      "banana",
      "broccoli",
      "carrot",
      "citron",
      "cucumber",
      "fruit",
      "garlic",
      "grape",
      "gurka",
      "lemon",
      "lettuce",
      "lime",
      "lok",
      "morot",
      "onion",
      "orange",
      "potato",
      "potatis",
      "sallad",
      "salad",
      "tomat",
      "tomato",
      "vegetable",
    ],
  },
  {
    category: "Kyl",
    words: [
      "agg",
      "bacon",
      "beef",
      "butter",
      "cheese",
      "chicken",
      "cold cuts",
      "cream",
      "dairy",
      "egg",
      "fish",
      "fisk",
      "gradde",
      "ham",
      "kott",
      "kyckling",
      "lamb",
      "lax",
      "meat",
      "milk",
      "mjolk",
      "ost",
      "pork",
      "salmon",
      "skinka",
      "smor",
      "tofu",
      "yoghurt",
      "yogurt",
    ],
  },
  {
    category: "Frys",
    words: ["frozen", "glass", "ice cream", "pizza"],
  },
  {
    category: "Torrvaror",
    words: [
      "bagel",
      "bakery",
      "beans",
      "bread",
      "brod",
      "bun",
      "canned",
      "cereal",
      "coffee",
      "flour",
      "kaffe",
      "oil",
      "olja",
      "pasta",
      "pepper",
      "rice",
      "ris",
      "roll",
      "salt",
      "sauce",
      "socker",
      "sugar",
      "tea",
      "tortilla",
    ],
  },
  {
    category: "Dryck",
    words: ["beer", "cola", "drink", "juice", "ol", "saft", "soda", "vatten", "vin", "water", "wine"],
  },
  {
    category: "Hem & städ",
    words: ["batteries", "battery", "detergent", "disk", "lamp", "paper", "soap", "sop", "trash", "tvat", "toilet"],
  },
  {
    category: "Apotek",
    words: ["alvedon", "aspirin", "ipren", "medicin", "medicine", "pharmacy", "plaster", "vitamin"],
  },
  {
    category: "Djur",
    words: ["cat", "dog", "hund", "hundmat", "katt", "pet"],
  },
];

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <main id="reaction-core-page" class="oxide-shell">
    <section class="control-rail">
      <div class="brand-block">
        <div class="brand-mark">
          <span>C</span>
          <i></i>
          <span>O</span>
        </div>
        <div>
          <p class="eyebrow">EutherOxide</p>
          <h1>Reaction Core</h1>
        </div>
      </div>

      <nav class="app-nav" aria-label="primary">
        <div class="app-nav-group">
          <span>Home</span>
          <div class="app-nav-grid">
            <button data-app-route="play" type="button">Reaction Lobby</button>
          </div>
        </div>
        <div class="app-nav-group">
          <span>Play Vessels</span>
          <div class="app-nav-grid">
            <button data-play-mode="megadrive" type="button">MegaDrive</button>
            <button data-play-mode="eutherdogs" type="button">EutherDogs</button>
            <button data-play-mode="euthercivet" type="button">EutherCivet</button>
            <button data-play-mode="eutheralert" type="button">EutherAlert</button>
            <button data-play-mode="eutherdoom" type="button">EutherDoom</button>
            <button data-play-mode="eutherduke" type="button">EutherDuke</button>
          </div>
        </div>
        <div class="app-nav-group">
          <span>Social Tools</span>
          <div class="app-nav-grid">
            <button data-reaction-home-action="video-chat" type="button">Video Chat</button>
            <button data-workspace-window="books" type="button">Audiobooks</button>
            <button data-workspace-window="shopping" type="button">Shopping</button>
            <button data-workspace-window="interaction" type="button">Social Desk</button>
          </div>
        </div>
      </nav>

      ${playHomeMarkup()}

      <div class="rail-section lobby-section" id="lobby-section">
        <div class="section-head">
          <p class="section-label">Lobby</p>
          <div class="section-actions">
            <button id="admin-open" class="mini-action" type="button" hidden>Admin</button>
            <button id="lobby-refresh" class="mini-action" type="button">Scan</button>
          </div>
        </div>
        <div class="lobby-card" id="lobby-card">
          <strong id="lobby-title">Main Reaction Vessel</strong>
          <span id="lobby-meta">No instance scan</span>
          <span id="lobby-host">Host: open</span>
        </div>
        <div class="lobby-instances" id="lobby-instances"></div>
        <div class="lobby-actions">
          <button id="instance-start" type="button">Start MegaDrive</button>
          <button id="alert-instance-start" type="button">Start EutherAlert</button>
          <button id="doom-instance-start" type="button">Start EutherDoom</button>
          <button id="instance-join" type="button">Join</button>
          <button id="claim-p1" type="button">Claim P1</button>
          <button id="claim-p2" type="button">Claim P2</button>
          <button id="release-slot" type="button">Release</button>
          <button id="spectate-instance" type="button">Spectate</button>
          <button id="kick-p1" type="button">Kick P1</button>
          <button id="kick-p2" type="button">Kick P2</button>
          <button id="close-instance" type="button">Close</button>
        </div>
      </div>

      <div class="rail-section dogs-mode-section" id="dogs-mode-section">
        <p class="section-label">EutherDogs</p>
        <button id="eutherdogs-toggle" class="primary-action" type="button">EutherDogs</button>
        <div class="dogs-asset-switch" aria-label="EutherDogs asset resolution">
          <button data-dogs-asset-mode="classic" type="button">Low</button>
          <button data-dogs-asset-mode="2x" type="button">2x</button>
        </div>
      </div>

      <div class="rail-section civet-mode-section" id="civet-mode-section">
        <div class="section-head">
          <p class="section-label">EutherCivet</p>
          <span id="euthercivet-status">Idle</span>
        </div>
        <div class="civet-rail-actions">
          <button id="euthercivet-reset" class="primary-action" type="button">Reset Estate</button>
          <button id="euthercivet-step" type="button">Tick</button>
        </div>
      </div>

      <div class="rail-section doom-debug-panel" id="doom-debug-panel" hidden>
        <div class="section-head">
          <p class="section-label">EutherDoom</p>
          <div class="section-actions">
            <button id="doom-refresh" class="mini-action" type="button">Scan</button>
            <button id="doom-replay" class="mini-action" type="button">Replay</button>
            <button id="doom-reset" class="mini-action" type="button">Reset</button>
          </div>
        </div>
        <div class="doom-card">
          <strong id="doom-title">Lockstep Relay</strong>
          <span id="doom-meta">No Doom server selected</span>
        </div>
        <div class="doom-vessel-status" id="doom-vessel-status"></div>
        <div class="doom-actions">
          <button id="doom-ready" type="button">Ready</button>
          <button id="doom-unready" type="button">Stand</button>
          <button id="doom-drive" type="button">Drive</button>
          <button id="doom-send" type="button">Debug</button>
        </div>
        <details class="doom-debug-details">
          <summary>Debug tic controls</summary>
          <div class="doom-command-grid">
            <label>Tic <input id="doom-tic" type="number" value="0" min="0" step="1" /></label>
            <label>Forward <input id="doom-forward" type="number" value="10" min="-127" max="127" step="1" /></label>
            <label>Strafe <input id="doom-strafe" type="number" value="0" min="-127" max="127" step="1" /></label>
            <label>Turn <input id="doom-turn" type="number" value="0" min="-32768" max="32767" step="1" /></label>
            <label>Buttons <input id="doom-buttons" type="number" value="1" min="0" max="65535" step="1" /></label>
            <label>Weapon <input id="doom-weapon" type="number" value="0" min="0" max="255" step="1" /></label>
          </div>
        </details>
        <div class="doom-frame-log" id="doom-frame-log"></div>
      </div>

      <details id="megadrive-panel" class="rail-section megadrive-panel" ${forceMegaDriveStartup ? "open" : ""}>
        <summary>
          <span>MegaDrive</span>
          <strong id="rom-name">Load Mega Drive</strong>
        </summary>

        <label class="rom-drop" id="rom-drop">
          <input id="rom-input" type="file" accept=".bin,.gen,.md,.smd,.rom" />
          <span>ROM Reagent</span>
          <strong>Choose ROM</strong>
        </label>

        <div class="rail-section rom-browser-section">
          <div class="section-head">
            <p class="section-label">ROM Directory</p>
            <button id="rom-dir-set" class="mini-action" type="button">Set</button>
          </div>
          <div class="rom-dir-path" id="rom-dir-path">No directory</div>
          <div class="rom-dir-manual" id="rom-dir-manual">
            <input id="rom-dir-input" type="text" placeholder="/path/to/roms" aria-label="ROM directory path" />
            <button id="rom-dir-apply" class="mini-action" type="button">Use</button>
          </div>
          <div class="rom-breadcrumb" id="rom-breadcrumb">/</div>
          <div class="rom-list" id="rom-list">
            <button type="button" disabled>Set ROM directory</button>
          </div>
        </div>

        <div class="rail-section transport-section">
          <p class="section-label">Transport</p>
          <div class="transport-grid">
            <button id="play-toggle" class="primary-action" type="button">Play</button>
            <button id="step-frame" type="button">Step</button>
            <button id="reset-core" type="button">Reset</button>
          </div>
        </div>

        <div class="rail-section state-section">
          <p class="section-label">Argon States</p>
          <div class="state-grid" id="state-grid">
            <div class="state-slot" data-slot-row="1">
              <span>1</span><strong>Empty</strong>
              <button data-state-action="save" data-slot="1" type="button">Save</button>
              <button data-state-action="load" data-slot="1" type="button">Load</button>
            </div>
            <div class="state-slot" data-slot-row="2">
              <span>2</span><strong>Empty</strong>
              <button data-state-action="save" data-slot="2" type="button">Save</button>
              <button data-state-action="load" data-slot="2" type="button">Load</button>
            </div>
            <div class="state-slot" data-slot-row="3">
              <span>3</span><strong>Empty</strong>
              <button data-state-action="save" data-slot="3" type="button">Save</button>
              <button data-state-action="load" data-slot="3" type="button">Load</button>
            </div>
          </div>
        </div>
      </details>

      <div class="rail-section volume-section">
        <div class="volume-head">
          <p class="section-label">Sound</p>
          <strong id="volume-value">80%</strong>
        </div>
        <input id="volume-slider" type="range" min="0" max="100" value="80" aria-label="volume" />
        <div class="volume-head">
          <p class="section-label">Mic</p>
          <strong id="mic-volume-value">100%</strong>
        </div>
        <input id="mic-volume-slider" type="range" min="0" max="160" value="100" aria-label="mic volume" />
        <div class="volume-head doom-mouse-head">
          <p class="section-label">Doom/Duke mouse</p>
          <strong id="doom-mouse-sensitivity-value">2.2x</strong>
        </div>
        <input id="doom-mouse-sensitivity" type="range" min="0.6" max="4" step="0.1" value="2.2" aria-label="doom and duke mouse sensitivity" />
      </div>

      <div class="rail-section">
        <div class="section-head">
          <p class="section-label">Pad</p>
          <button id="controls-open" class="mini-action" type="button">Controls</button>
        </div>
        <div class="player-switch" aria-label="controller port">
          <button data-player-port="1" type="button">1st Player</button>
          <button data-player-port="2" type="button">2nd Player</button>
        </div>
        <div class="pad-grid" aria-label="controller">
          <button data-pad="up" class="pad-key pad-up" type="button">U</button>
          <button data-pad="left" class="pad-key pad-left" type="button">L</button>
          <button data-pad="right" class="pad-key pad-right" type="button">R</button>
          <button data-pad="down" class="pad-key pad-down" type="button">D</button>
          <button data-pad="a" class="pad-key action-a" type="button">A</button>
          <button data-pad="b" class="pad-key action-b" type="button">B</button>
          <button data-pad="c" class="pad-key action-c" type="button">C</button>
          <button data-pad="start" class="pad-key action-start" type="button">Start</button>
        </div>
      </div>
    </section>

    <section class="reactor-stage">
      <header class="stage-header">
        <div>
          <p class="eyebrow">Alkene Chamber</p>
          <h2 id="game-title">No ROM</h2>
        </div>
        <div class="stage-tools">
          <div class="build-console" id="build-console">
            <div class="build-slider" aria-label="bridge build profile">
              <button data-build-profile="debug" type="button">Debug</button>
              <button data-build-profile="release" type="button">Bin</button>
            </div>
            <button id="release-build" class="build-button" type="button">Build</button>
            <span id="build-lamp" class="build-lamp is-cold" title="Release binary not armed"></span>
          </div>
          <button id="mobile-toggle" class="mobile-toggle" type="button" aria-pressed="false">Mobile</button>
          <div class="player-switch stage-player-switch" aria-label="controller port">
            <button data-player-port="1" type="button">1P</button>
            <button data-player-port="2" type="button">2P</button>
          </div>
          <div class="runtime-chip" id="runtime-chip">WEB VIEW</div>
        </div>
      </header>

      ${reactionLobbyHomeMarkup()}

      <div class="screen-vessel">
        <div class="screen-glass" id="screen-glass">
          <canvas id="video" width="320" height="224"></canvas>
          <canvas id="shader-video" width="320" height="224"></canvas>
          <video id="bridge-video" muted playsinline autoplay></video>
          <audio id="bridge-audio" autoplay></audio>
          <div id="eutherdoom-renderer" class="eutherdoom-renderer" aria-hidden="true">
            <div id="eutherdoom-dos" class="eutherdoom-dos"></div>
            <div id="eutherdoom-renderer-status" class="eutherdoom-renderer-status">Doom runtime idle</div>
          </div>
          <div id="eutherduke-renderer" class="eutherduke-renderer" aria-hidden="true">
            <iframe id="eutherduke-frame" class="eutherduke-frame" title="EutherDuke runtime"></iframe>
            <div id="eutherduke-runtime-panel" class="eutherduke-runtime-panel">
              <span>EDuke32 / WebAssembly Vessel</span>
              <strong>EutherDuke runtime not installed</strong>
              <p>Expected external runtime at /home/nichlas/eutherduke-runtime with index.html, wasm/data files, and legal Duke game data.</p>
            </div>
          </div>
          <div id="eutheralert-renderer" class="eutheralert-renderer" aria-hidden="true">
            <iframe id="eutheralert-frame" class="eutheralert-frame" title="EutherAlert runtime"></iframe>
            <div id="eutheralert-openra-panel" class="eutheralert-openra-panel">
              <span>OpenRA</span>
              <strong id="eutheralert-openra-status">Runtime idle</strong>
              <div>
                <button id="eutheralert-openra-start" type="button">Start Server</button>
                <button id="eutheralert-openra-client-start" type="button">Start Client</button>
                <button id="eutheralert-openra-client-stop" type="button">Stop Client</button>
                <button id="eutheralert-openra-debug" type="button">Debug</button>
                <button id="eutheralert-openra-stop" type="button">Stop Server</button>
              </div>
            </div>
            <div id="eutheralert-portrait-menu" class="eutheralert-portrait-menu" aria-label="EutherAlert navigation">
              <button id="eutheralert-fullscreen" type="button">Fullscreen</button>
              <button id="eutheralert-back" type="button">Back</button>
              <button id="eutheralert-lobby" type="button">Lobby</button>
            </div>
            <div id="eutheralert-runtime-panel" class="eutheralert-runtime-panel">
              <span>Command and Conquer: Red Alert Vessel</span>
              <strong>EutherAlert runtime could not start</strong>
              <p>Expected repo runtime at /eutheralert/index.html with a running OpenRA server and browser-streamed client.</p>
            </div>
          </div>
          <div id="euthercivet-renderer" class="euthercivet-renderer" aria-hidden="true">
            <div class="euthercivet-world" id="euthercivet-world"></div>
            <aside class="euthercivet-panel">
              <div class="euthercivet-titleline">
                <span>Estate Ledger</span>
                <strong id="euthercivet-title">EutherCivet</strong>
              </div>
              <div id="euthercivet-bars" class="euthercivet-bars"></div>
              <div id="euthercivet-stats" class="euthercivet-stats"></div>
              <div id="euthercivet-actions" class="euthercivet-actions"></div>
              <div id="euthercivet-log" class="euthercivet-log"></div>
            </aside>
          </div>
          <canvas id="eutherdogs-canvas" width="320" height="224"></canvas>
          <div id="eutherdogs-loading-overlay" class="eutherdogs-loading-overlay" hidden>
            <div class="eutherdogs-loading-card">
              <span id="eutherdogs-loading-kicker">RX Asset Warmup</span>
              <strong id="eutherdogs-loading-percent">0%</strong>
              <div class="eutherdogs-loading-meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
                <span id="eutherdogs-loading-fill" style="width: 0%"></span>
              </div>
              <p id="eutherdogs-loading-label">Preparing the counter</p>
              <small id="eutherdogs-loading-detail">0 / 0 assets cached</small>
            </div>
          </div>
          <div id="eutherdogs-hud" class="eutherdogs-hud" aria-live="polite"></div>
          <div id="eutherdogs-console" class="eutherdogs-console" aria-hidden="true">
            <div class="eutherdogs-console-top">
              <div class="eutherdogs-logo"></div>
              <div class="eutherdogs-shift">
                <span>Night shift</span>
                <strong id="eutherdogs-alert">Mission 1/10</strong>
              </div>
            </div>
            <div class="eutherdogs-dispensary">
              <div>
                <span>Mission</span>
                <strong id="eutherdogs-rx-left">0</strong>
              </div>
              <div>
                <span id="eutherdogs-clock-label">Elapsed</span>
                <strong id="eutherdogs-clock">--</strong>
              </div>
            </div>
            <span id="eutherdogs-targets-left" hidden>0</span>
            <span id="eutherdogs-cash" hidden>$0</span>
            <div class="eutherdogs-vitals">
              <span id="eutherdogs-lamp" class="eutherdogs-lamp"></span>
              <div class="eutherdogs-health">
                <span id="eutherdogs-health-fill"></span>
              </div>
              <strong id="eutherdogs-weapon">Scanner</strong>
            </div>
          </div>
          <div id="eutherdogs-menu" class="eutherdogs-menu" aria-hidden="true">
            <div class="eutherdogs-menu-panel">
              <header>
                <div>
                  <span id="eutherdogs-menu-kicker">RX Store</span>
                  <h3 id="eutherdogs-menu-title">Counter Before Chaos</h3>
                </div>
                <strong id="eutherdogs-menu-cash">$0</strong>
              </header>
              <div id="eutherdogs-menu-body" class="eutherdogs-menu-body"></div>
              <footer>
                <button id="eutherdogs-staff-open" type="button">Staff</button>
                <button id="eutherdogs-store-open" type="button">RX Store</button>
                <button id="eutherdogs-briefing-open" type="button">Briefing</button>
                <button id="eutherdogs-scores-open" type="button">Scores</button>
                <button id="eutherdogs-controls-open" type="button">Controls</button>
                <button id="eutherdogs-start-shift" class="primary-action" type="button">Start shift</button>
              </footer>
            </div>
          </div>
          <div id="eutherdogs-inventory-popup" class="eutherdogs-inventory-popup" aria-hidden="true">
            <div class="eutherdogs-inventory-popup-panel">
              <header>
                <div>
                  <span>Inventory</span>
                  <h3 id="eutherdogs-inventory-title">Field Kit</h3>
                </div>
                <button id="eutherdogs-inventory-close" type="button" aria-label="Close inventory">X</button>
              </header>
              <div id="eutherdogs-inventory-body" class="eutherdogs-inventory-body"></div>
            </div>
          </div>
          <div class="scanlines"></div>
          <div class="oxidation-ring"></div>
        </div>
      </div>

      <div class="reaction-strip">
        <span>C=C</span>
        <span>C#C</span>
        <span>R-CHO</span>
        <span>O2</span>
        <span>e- flow</span>
      </div>
    </section>

    <aside class="telemetry-panel">
      <div class="metric hero-metric">
        <span>Status</span>
        <strong id="status-text">IDLE</strong>
      </div>
      <div class="shader-drawer" id="shader-drawer">
        <button id="shader-toggle" class="shader-toggle" type="button">
          <span>Shaders</span>
          <strong id="shader-mode">System Regis CRT</strong>
        </button>
        <div class="shader-panel" id="shader-panel">
          <select id="shader-select" aria-label="video shader"></select>
          <div id="shader-controls" class="shader-controls"></div>
        </div>
      </div>
      <div class="perf-drawer" id="perf-drawer">
        <button id="perf-toggle" class="perf-toggle" type="button">
          <span>Perf</span>
          <strong id="perf-summary">0.00 ms | 0 lead</strong>
        </button>
        <div class="metric-grid">
          <div class="metric"><span>Frame</span><strong id="frame-count">0</strong></div>
          <div class="metric"><span>Timing</span><strong id="timing-mode">NTSC</strong></div>
          <div class="metric"><span>Region</span><strong id="region-mode">AUTO</strong></div>
          <div class="metric"><span>Reset PC</span><strong id="reset-pc">$000000</strong></div>
          <div class="metric"><span>Cycles</span><strong id="cycle-count">0</strong></div>
          <div class="metric"><span>Steps</span><strong id="step-count">0</strong></div>
          <div class="metric"><span>Frame ms</span><strong id="frame-ms">0.00</strong></div>
          <div class="metric"><span>Bridge</span><strong id="bridge-mode">WEB</strong></div>
          <div class="metric"><span>Fetch ms</span><strong id="fetch-ms">0.00</strong></div>
          <div class="metric"><span>Draw ms</span><strong id="draw-ms">0.00</strong></div>
          <div class="metric"><span>Audio lead</span><strong id="audio-lead-ms">0</strong></div>
          <div class="metric"><span>Transport</span><strong id="transport-mode">INIT</strong></div>
          <div class="metric"><span>RTC lease</span><strong id="rtc-lease-status">idle</strong></div>
          <div class="metric"><span>Input</span><strong id="input-status">idle</strong></div>
          <div class="metric"><span>Video age</span><strong id="video-age-status">idle</strong></div>
          <div class="metric"><span>Build</span><strong id="build-id">dev</strong></div>
        </div>
      </div>
      <div class="video-chat-panel is-collapsed" id="video-chat-panel">
        <button id="video-chat-toggle" class="video-chat-toggle" type="button">
          <span>Video Chat</span>
          <strong id="video-chat-status">idle</strong>
        </button>
        <div class="video-chat-body" id="video-chat-body">
          <div id="video-chat-stage" class="video-chat-stage">
            <span>Video chat idle</span>
          </div>
          <div class="video-chat-actions">
            <button id="video-chat-watch" type="button">Watch</button>
            <button id="video-chat-camera" type="button">Camera</button>
            <button id="video-chat-mute" type="button">Mute</button>
            <button id="video-chat-leave" type="button">Leave</button>
          </div>
        </div>
      </div>
      <div class="chat-panel">
        <div class="section-head">
          <p class="section-label">Reaction Chat</p>
          <button id="chat-refresh" class="mini-action" type="button">Sync</button>
        </div>
        <div id="chat-list" class="chat-list">
          <span>Chat offline</span>
        </div>
        <form id="chat-form" class="chat-form">
          <input id="chat-input" type="text" maxlength="320" placeholder="message" aria-label="chat message" autocomplete="off" />
          <button type="submit">Send</button>
        </form>
      </div>
      <div class="reaction-log">
        <p class="section-label">Oxidative Trace</p>
        <ol id="trace-list">
          <li>Core cold</li>
          <li>Awaiting substrate</li>
          <li>Canvas online</li>
        </ol>
      </div>
    </aside>
  </main>
  <main id="interaction-lobby-page" class="interaction-lobby-page" hidden>
    ${interactionLobbyPageMarkup()}
  </main>
  <div id="workspace-window-layer" class="workspace-window-layer" hidden>
    <section class="workspace-window" role="dialog" aria-modal="false" aria-labelledby="workspace-window-title">
      <header class="workspace-window-head">
        <div>
          <p class="eyebrow" id="workspace-window-eyebrow">Workspace</p>
          <h2 id="workspace-window-title">Window</h2>
        </div>
        <button id="workspace-window-close" class="mini-action" type="button">Close</button>
      </header>
      <div class="workspace-window-body">
        <div id="workspace-window-dynamic" class="workspace-window-dynamic"></div>
        ${shoppingListPanelMarkup()}
      </div>
    </section>
  </div>
  <div class="user-menu" id="user-menu">
    <div class="user-menu-cluster">
      <button id="user-menu-toggle" class="user-menu-toggle" type="button" aria-haspopup="true" aria-expanded="false">
        <span class="user-presence-dot"></span>
        <strong id="user-menu-name">Nichlas</strong>
      </button>
      <button id="user-settings-toggle" class="user-settings-toggle" type="button" aria-label="Open user settings" title="User settings">&#9881;</button>
    </div>
    <div id="user-menu-dropdown" class="user-menu-dropdown" role="menu" aria-label="user menu">
      <button data-user-menu-action="profile" type="button" role="menuitem">Profile</button>
      <button data-user-menu-action="get-sync-app" type="button" role="menuitem">Get the EutherSync app</button>
      <button data-user-menu-action="reaction-lobby" type="button" role="menuitem">Reaction Lobby</button>
      <button data-user-menu-action="shopping-list" type="button" role="menuitem">Shopping List</button>
      <button data-user-menu-action="audiobooks" type="button" role="menuitem">Audiobooks</button>
      <button data-user-menu-action="eutherium" type="button" role="menuitem">Eutherium</button>
      <button data-user-menu-action="get-list-app" type="button" role="menuitem">Get the list app</button>
      <button data-user-menu-action="admin" type="button" role="menuitem" hidden>Admin</button>
      <button data-user-menu-action="friends" type="button" role="menuitem">Friends</button>
      <button data-user-menu-action="shared-spaces" type="button" role="menuitem">Shared Spaces</button>
      <button data-user-menu-action="settings" type="button" role="menuitem">Settings</button>
      <button data-user-menu-action="logout" type="button" role="menuitem">Log out</button>
    </div>
  </div>
  <div class="mobile-pad" id="mobile-pad" aria-label="mobile controller">
    <div class="mobile-pad-cluster mobile-dpad">
      <button data-pad="up" class="pad-key pad-up" type="button">U</button>
      <button data-pad="left" class="pad-key pad-left" type="button">L</button>
      <button data-pad="right" class="pad-key pad-right" type="button">R</button>
      <button data-pad="down" class="pad-key pad-down" type="button">D</button>
    </div>
    <div class="mobile-system">
      <button data-mobile-command="play" class="mobile-command primary-action" type="button">Play</button>
      <div class="player-switch mobile-player-switch" aria-label="controller port">
        <button data-player-port="1" type="button">1P</button>
        <button data-player-port="2" type="button">2P</button>
      </div>
      <button data-pad="start" class="pad-key mobile-start" type="button">Start</button>
      <button data-mobile-command="reset" class="mobile-command" type="button">Reset</button>
      <button data-mobile-command="controls" class="mobile-command" type="button">Bind</button>
    </div>
    <div class="mobile-pad-cluster mobile-actions">
      <button data-pad="a" class="pad-key action-a" type="button">A</button>
      <button data-pad="b" class="pad-key action-b" type="button">B</button>
      <button data-pad="c" class="pad-key action-c" type="button">C</button>
    </div>
  </div>
  <div id="controls-modal" class="controls-modal" aria-hidden="true">
    <div class="controls-dialog" role="dialog" aria-modal="true" aria-labelledby="controls-title">
      <header class="controls-dialog-head">
        <div>
          <p class="eyebrow">Input Matrix</p>
          <h2 id="controls-title">Controls</h2>
        </div>
        <div class="controls-actions">
          <button id="controls-reset" class="mini-action" type="button">Reset</button>
          <button id="controls-close" class="mini-action" type="button" aria-label="Close controls">Close</button>
        </div>
      </header>
      <div class="controls-body">
        <section class="binding-list" aria-label="controller bindings">
          <p class="section-label">Bindings</p>
          <div id="binding-rows" class="binding-rows"></div>
        </section>
        <section class="controller-guide" aria-label="controller map">
          <img src="${controllerGuideUrl}" alt="Neon controller binding map" />
          <div class="capture-readout" id="capture-readout">Ready</div>
        </section>
        <section class="gamepad-panel" aria-label="detected gamepads">
          <p class="section-label">Gilrs Pads</p>
          <div id="gamepad-list" class="gamepad-list">
            <span>No pad detected</span>
          </div>
        </section>
      </div>
    </div>
  </div>
  <div id="admin-modal" class="admin-modal" aria-hidden="true">
    <div class="admin-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-title">
      <header class="admin-dialog-head">
        <div>
          <p class="eyebrow">Host Control</p>
          <h2 id="admin-title">Users</h2>
        </div>
        <div class="controls-actions">
          <button id="admin-refresh" class="mini-action" type="button">Sync</button>
          <button id="admin-close" class="mini-action" type="button">Close</button>
        </div>
      </header>
      <div class="admin-dialog-body">
        <section class="admin-list-panel">
          <p class="section-label">User List</p>
          <div class="admin-users" id="admin-users">
            <span>Host admin offline</span>
          </div>
        </section>
        <section class="admin-edit-panel">
          <p class="section-label">Edit User</p>
          <div class="admin-form">
            <input id="admin-username" type="text" placeholder="user" aria-label="user" />
            <input id="admin-password" type="password" placeholder="new password" aria-label="new password" />
            <button id="admin-user-add" type="button">Add/Reset</button>
          </div>
          <div class="admin-form">
            <input id="invite-email" type="email" placeholder="invite email placeholder" aria-label="invite email" />
            <button id="invite-send" type="button">Invite</button>
          </div>
          <div class="admin-award-panel">
            <p class="section-label">Eutherium Dispenser</p>
            <div class="admin-award-form">
              <select id="admin-award-user" aria-label="award user"></select>
              <input id="admin-award-amount" type="number" min="1" step="1" value="100" aria-label="award amount" />
              <input id="admin-award-reason" type="text" placeholder="reason" aria-label="award reason" />
              <button id="admin-award-send" type="button">Award</button>
            </div>
            <span id="admin-award-status">Ledger only, traceable awards</span>
          </div>
        </section>
      </div>
    </div>
  </div>
`;

videoCanvas = document.querySelector<HTMLCanvasElement>("#video")!;
videoContext = videoCanvas.getContext("2d", { alpha: false })!;
shaderCanvas = document.querySelector<HTMLCanvasElement>("#shader-video")!;
const bridgeVideo = document.querySelector<HTMLVideoElement>("#bridge-video")!;
const bridgeRtcAudio = document.querySelector<HTMLAudioElement>("#bridge-audio")!;
const eutherDoomRenderer = document.querySelector<HTMLDivElement>("#eutherdoom-renderer")!;
const eutherDoomDos = document.querySelector<HTMLDivElement>("#eutherdoom-dos")!;
const eutherDoomRendererStatus = document.querySelector<HTMLDivElement>("#eutherdoom-renderer-status")!;
const eutherDukeRenderer = document.querySelector<HTMLDivElement>("#eutherduke-renderer")!;
const eutherDukeFrame = document.querySelector<HTMLIFrameElement>("#eutherduke-frame")!;
const eutherDukeRuntimePanel = document.querySelector<HTMLDivElement>("#eutherduke-runtime-panel")!;
const eutherAlertRenderer = document.querySelector<HTMLDivElement>("#eutheralert-renderer")!;
const eutherAlertFrame = document.querySelector<HTMLIFrameElement>("#eutheralert-frame")!;
const eutherAlertRuntimePanel = document.querySelector<HTMLDivElement>("#eutheralert-runtime-panel")!;
const eutherAlertRuntimeTitle = eutherAlertRuntimePanel.querySelector<HTMLElement>("strong")!;
const eutherAlertRuntimeMessage = eutherAlertRuntimePanel.querySelector<HTMLElement>("p")!;
const eutherAlertOpenRaStatus = document.querySelector<HTMLElement>("#eutheralert-openra-status")!;
const eutherAlertOpenRaStart = document.querySelector<HTMLButtonElement>("#eutheralert-openra-start")!;
const eutherAlertOpenRaStop = document.querySelector<HTMLButtonElement>("#eutheralert-openra-stop")!;
const eutherAlertOpenRaClientStart = document.querySelector<HTMLButtonElement>("#eutheralert-openra-client-start")!;
const eutherAlertOpenRaClientStop = document.querySelector<HTMLButtonElement>("#eutheralert-openra-client-stop")!;
const eutherAlertOpenRaDebug = document.querySelector<HTMLButtonElement>("#eutheralert-openra-debug")!;
const eutherAlertFullscreen = document.querySelector<HTMLButtonElement>("#eutheralert-fullscreen")!;
const eutherAlertBack = document.querySelector<HTMLButtonElement>("#eutheralert-back")!;
const eutherAlertLobby = document.querySelector<HTMLButtonElement>("#eutheralert-lobby")!;
const eutherCivetRenderer = document.querySelector<HTMLDivElement>("#euthercivet-renderer")!;
const eutherCivetWorld = document.querySelector<HTMLDivElement>("#euthercivet-world")!;
const eutherCivetStatus = document.querySelector<HTMLElement>("#euthercivet-status")!;
const eutherCivetTitle = document.querySelector<HTMLElement>("#euthercivet-title")!;
const eutherCivetBars = document.querySelector<HTMLDivElement>("#euthercivet-bars")!;
const eutherCivetStats = document.querySelector<HTMLDivElement>("#euthercivet-stats")!;
const eutherCivetActions = document.querySelector<HTMLDivElement>("#euthercivet-actions")!;
const eutherCivetLog = document.querySelector<HTMLDivElement>("#euthercivet-log")!;
dogsCanvas = document.querySelector<HTMLCanvasElement>("#eutherdogs-canvas")!;
dogsContext = dogsCanvas.getContext("2d", { alpha: false })!;
bridgeVideo.addEventListener("loadedmetadata", syncBridgeVideoGeometry);
bridgeVideo.addEventListener("resize", syncBridgeVideoGeometry);
bridgeVideo.addEventListener("playing", syncBridgeVideoGeometry);

const reactionCorePage = document.querySelector<HTMLElement>("#reaction-core-page")!;
const interactionLobbyPage = document.querySelector<HTMLElement>("#interaction-lobby-page")!;
const userMenu = document.querySelector<HTMLDivElement>("#user-menu")!;
const userMenuToggle = document.querySelector<HTMLButtonElement>("#user-menu-toggle")!;
const userSettingsToggle = document.querySelector<HTMLButtonElement>("#user-settings-toggle")!;
const userMenuName = document.querySelector<HTMLElement>("#user-menu-name")!;
const userMenuDropdown = document.querySelector<HTMLDivElement>("#user-menu-dropdown")!;
const userMenuAdmin = document.querySelector<HTMLButtonElement>('[data-user-menu-action="admin"]')!;
const workspaceWindowLayer = document.querySelector<HTMLDivElement>("#workspace-window-layer")!;
const workspaceWindowTitle = document.querySelector<HTMLElement>("#workspace-window-title")!;
const workspaceWindowEyebrow = document.querySelector<HTMLElement>("#workspace-window-eyebrow")!;
const workspaceWindowClose = document.querySelector<HTMLButtonElement>("#workspace-window-close")!;
const workspaceWindowDynamic = document.querySelector<HTMLDivElement>("#workspace-window-dynamic")!;
const appNavButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-app-route]"));
const playHomePanel = document.querySelector<HTMLElement>("#play-home-panel")!;
const playModeStatus = document.querySelector<HTMLElement>("#play-mode-status")!;
const playModeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-play-mode]"));
const reactionLobbyHome = document.querySelector<HTMLElement>("#reaction-lobby-home")!;
const reactionLobbySummary = document.querySelector<HTMLDivElement>("#reaction-lobby-summary")!;
const reactionLobbyVessels = document.querySelector<HTMLDivElement>("#reaction-lobby-vessels")!;
const eutheriumLobbyStatusEl = document.querySelector<HTMLElement>("#eutherium-lobby-status")!;
const eutheriumLobbyBalanceEl = document.querySelector<HTMLElement>("#eutherium-lobby-balance")!;
const eutheriumLobbyAwardEl = document.querySelector<HTMLDivElement>("#eutherium-lobby-award")!;
const eutheriumLobbyFeedEl = document.querySelector<HTMLDivElement>("#eutherium-lobby-feed")!;
const lobbySection = document.querySelector<HTMLDivElement>("#lobby-section")!;
const dogsModeSection = document.querySelector<HTMLDivElement>("#dogs-mode-section")!;
const shoppingListPanel = document.querySelector<HTMLDivElement>("#interaction-shopping-panel")!;
const interactionCurrentUserName = document.querySelector<HTMLElement>("#interaction-current-user-name")!;
const interactionCurrentUserStatus = document.querySelector<HTMLElement>("#interaction-current-user-status")!;
const friendPreviewCount = document.querySelector<HTMLElement>("#friend-preview-count")!;
const friendPreviewRows = document.querySelector<HTMLDivElement>("#friend-preview-rows")!;
const shoppingListTitle = document.querySelector<HTMLElement>("#shopping-list-title")!;
const shoppingListStatusLabel = document.querySelector<HTMLElement>("#shopping-list-status")!;
const shoppingListSharedIdLabel = document.querySelector<HTMLElement>("#shopping-list-shared-id")!;
const shoppingShareStatus = document.querySelector<HTMLElement>("#shopping-share-status")!;
const shoppingShareCompact = document.querySelector<HTMLDivElement>("#shopping-share-compact")!;
const shoppingListMembersEl = document.querySelector<HTMLDivElement>("#shopping-list-members")!;
const shoppingShareForm = document.querySelector<HTMLFormElement>("#shopping-share-form")!;
const shoppingShareUser = document.querySelector<HTMLSelectElement>("#shopping-share-user")!;
const shoppingShareRole = document.querySelector<HTMLSelectElement>("#shopping-share-role")!;
const shoppingListItems = document.querySelector<HTMLDivElement>("#shopping-list-items")!;
const shoppingListAddForm = document.querySelector<HTMLFormElement>("#shopping-list-add-form")!;
const shoppingListAddInput = document.querySelector<HTMLInputElement>("#shopping-list-add-input")!;
const shoppingListCategory = document.querySelector<HTMLSelectElement>("#shopping-list-category")!;
const shoppingListMarkdownInput = document.querySelector<HTMLTextAreaElement>("#shopping-list-markdown")!;
const shoppingListSort = document.querySelector<HTMLButtonElement>("#shopping-list-sort")!;
const shoppingListSave = document.querySelector<HTMLButtonElement>("#shopping-list-save")!;
const volumeSlider = document.querySelector<HTMLInputElement>("#volume-slider")!;
const volumeValue = document.querySelector<HTMLElement>("#volume-value")!;
const micVolumeSlider = document.querySelector<HTMLInputElement>("#mic-volume-slider")!;
const micVolumeValue = document.querySelector<HTMLElement>("#mic-volume-value")!;
const romDirSet = document.querySelector<HTMLButtonElement>("#rom-dir-set")!;
const romDirPathLabel = document.querySelector<HTMLDivElement>("#rom-dir-path")!;
const romDirManual = document.querySelector<HTMLDivElement>("#rom-dir-manual")!;
const romDirInput = document.querySelector<HTMLInputElement>("#rom-dir-input")!;
const romDirApply = document.querySelector<HTMLButtonElement>("#rom-dir-apply")!;
const romBreadcrumb = document.querySelector<HTMLDivElement>("#rom-breadcrumb")!;
const romList = document.querySelector<HTMLDivElement>("#rom-list")!;
const shaderDrawer = document.querySelector<HTMLDivElement>("#shader-drawer")!;
const shaderToggle = document.querySelector<HTMLButtonElement>("#shader-toggle")!;
const shaderSelect = document.querySelector<HTMLSelectElement>("#shader-select")!;
const shaderMode = document.querySelector<HTMLElement>("#shader-mode")!;
const shaderControls = document.querySelector<HTMLDivElement>("#shader-controls")!;
const perfDrawer = document.querySelector<HTMLDivElement>("#perf-drawer")!;
const perfToggle = document.querySelector<HTMLButtonElement>("#perf-toggle")!;
const perfSummary = document.querySelector<HTMLElement>("#perf-summary")!;
const videoChatPanel = document.querySelector<HTMLDivElement>("#video-chat-panel")!;
const videoChatToggle = document.querySelector<HTMLButtonElement>("#video-chat-toggle")!;
const videoChatStatus = document.querySelector<HTMLElement>("#video-chat-status")!;
const videoChatStage = document.querySelector<HTMLDivElement>("#video-chat-stage")!;
const videoChatWatch = document.querySelector<HTMLButtonElement>("#video-chat-watch")!;
const videoChatCamera = document.querySelector<HTMLButtonElement>("#video-chat-camera")!;
const videoChatMute = document.querySelector<HTMLButtonElement>("#video-chat-mute")!;
const videoChatLeave = document.querySelector<HTMLButtonElement>("#video-chat-leave")!;
const chatRefresh = document.querySelector<HTMLButtonElement>("#chat-refresh")!;
const chatList = document.querySelector<HTMLDivElement>("#chat-list")!;
const chatForm = document.querySelector<HTMLFormElement>("#chat-form")!;
const chatInput = document.querySelector<HTMLInputElement>("#chat-input")!;
const romInput = document.querySelector<HTMLInputElement>("#rom-input")!;
const romDrop = document.querySelector<HTMLLabelElement>("#rom-drop")!;
const megaDrivePanel = document.querySelector<HTMLDetailsElement>("#megadrive-panel")!;
const lobbyRefresh = document.querySelector<HTMLButtonElement>("#lobby-refresh")!;
const lobbyTitle = document.querySelector<HTMLElement>("#lobby-title")!;
const lobbyMeta = document.querySelector<HTMLElement>("#lobby-meta")!;
const lobbyHost = document.querySelector<HTMLElement>("#lobby-host")!;
const lobbyInstances = document.querySelector<HTMLDivElement>("#lobby-instances")!;
const adminOpen = document.querySelector<HTMLButtonElement>("#admin-open")!;
const instanceStart = document.querySelector<HTMLButtonElement>("#instance-start")!;
const alertInstanceStart = document.querySelector<HTMLButtonElement>("#alert-instance-start")!;
const doomInstanceStart = document.querySelector<HTMLButtonElement>("#doom-instance-start")!;
const instanceJoin = document.querySelector<HTMLButtonElement>("#instance-join")!;
const claimP1 = document.querySelector<HTMLButtonElement>("#claim-p1")!;
const claimP2 = document.querySelector<HTMLButtonElement>("#claim-p2")!;
const releaseSlot = document.querySelector<HTMLButtonElement>("#release-slot")!;
const spectateInstance = document.querySelector<HTMLButtonElement>("#spectate-instance")!;
const kickP1 = document.querySelector<HTMLButtonElement>("#kick-p1")!;
const kickP2 = document.querySelector<HTMLButtonElement>("#kick-p2")!;
const closeInstance = document.querySelector<HTMLButtonElement>("#close-instance")!;
const adminModal = document.querySelector<HTMLDivElement>("#admin-modal")!;
const adminClose = document.querySelector<HTMLButtonElement>("#admin-close")!;
const adminRefresh = document.querySelector<HTMLButtonElement>("#admin-refresh")!;
const adminUsers = document.querySelector<HTMLDivElement>("#admin-users")!;
const adminUsername = document.querySelector<HTMLInputElement>("#admin-username")!;
const adminPassword = document.querySelector<HTMLInputElement>("#admin-password")!;
const adminUserAdd = document.querySelector<HTMLButtonElement>("#admin-user-add")!;
const inviteEmail = document.querySelector<HTMLInputElement>("#invite-email")!;
const inviteSend = document.querySelector<HTMLButtonElement>("#invite-send")!;
const adminAwardUser = document.querySelector<HTMLSelectElement>("#admin-award-user")!;
const adminAwardAmount = document.querySelector<HTMLInputElement>("#admin-award-amount")!;
const adminAwardReason = document.querySelector<HTMLInputElement>("#admin-award-reason")!;
const adminAwardSend = document.querySelector<HTMLButtonElement>("#admin-award-send")!;
const adminAwardStatus = document.querySelector<HTMLElement>("#admin-award-status")!;
const playToggle = document.querySelector<HTMLButtonElement>("#play-toggle")!;
const stepFrame = document.querySelector<HTMLButtonElement>("#step-frame")!;
const resetCore = document.querySelector<HTMLButtonElement>("#reset-core")!;
const eutherDogsToggle = document.querySelector<HTMLButtonElement>("#eutherdogs-toggle")!;
const civetModeSection = document.querySelector<HTMLDivElement>("#civet-mode-section")!;
const eutherCivetReset = document.querySelector<HTMLButtonElement>("#euthercivet-reset")!;
const eutherCivetStep = document.querySelector<HTMLButtonElement>("#euthercivet-step")!;
const doomDebugPanel = document.querySelector<HTMLDivElement>("#doom-debug-panel")!;
const doomRefresh = document.querySelector<HTMLButtonElement>("#doom-refresh")!;
const doomReplay = document.querySelector<HTMLButtonElement>("#doom-replay")!;
const doomReset = document.querySelector<HTMLButtonElement>("#doom-reset")!;
const doomReady = document.querySelector<HTMLButtonElement>("#doom-ready")!;
const doomUnready = document.querySelector<HTMLButtonElement>("#doom-unready")!;
const doomSend = document.querySelector<HTMLButtonElement>("#doom-send")!;
const doomDrive = document.querySelector<HTMLButtonElement>("#doom-drive")!;
const doomTitle = document.querySelector<HTMLElement>("#doom-title")!;
const doomMeta = document.querySelector<HTMLElement>("#doom-meta")!;
const doomVesselStatus = document.querySelector<HTMLDivElement>("#doom-vessel-status")!;
const doomMouseSensitivityInput = document.querySelector<HTMLInputElement>("#doom-mouse-sensitivity")!;
const doomMouseSensitivityValue = document.querySelector<HTMLElement>("#doom-mouse-sensitivity-value")!;
const doomTic = document.querySelector<HTMLInputElement>("#doom-tic")!;
const doomForward = document.querySelector<HTMLInputElement>("#doom-forward")!;
const doomStrafe = document.querySelector<HTMLInputElement>("#doom-strafe")!;
const doomTurn = document.querySelector<HTMLInputElement>("#doom-turn")!;
const doomButtons = document.querySelector<HTMLInputElement>("#doom-buttons")!;
const doomWeapon = document.querySelector<HTMLInputElement>("#doom-weapon")!;
const doomFrameLog = document.querySelector<HTMLDivElement>("#doom-frame-log")!;
const dogsAssetModeButtons = document.querySelectorAll<HTMLButtonElement>("[data-dogs-asset-mode]");
const stateGrid = document.querySelector<HTMLDivElement>("#state-grid")!;
const screenGlass = document.querySelector<HTMLDivElement>("#screen-glass")!;
const eutherDogsConsole = document.querySelector<HTMLDivElement>("#eutherdogs-console")!;
const eutherDogsAlert = document.querySelector<HTMLElement>("#eutherdogs-alert")!;
const eutherDogsRxLeft = document.querySelector<HTMLElement>("#eutherdogs-rx-left")!;
const eutherDogsTargetsLeft = document.querySelector<HTMLElement>("#eutherdogs-targets-left")!;
const eutherDogsCash = document.querySelector<HTMLElement>("#eutherdogs-cash")!;
const eutherDogsClockLabel = document.querySelector<HTMLElement>("#eutherdogs-clock-label")!;
const eutherDogsClock = document.querySelector<HTMLElement>("#eutherdogs-clock")!;
const eutherDogsLamp = document.querySelector<HTMLSpanElement>("#eutherdogs-lamp")!;
const eutherDogsHealthFill = document.querySelector<HTMLSpanElement>("#eutherdogs-health-fill")!;
const eutherDogsWeapon = document.querySelector<HTMLElement>("#eutherdogs-weapon")!;
const eutherDogsMenu = document.querySelector<HTMLDivElement>("#eutherdogs-menu")!;
const eutherDogsMenuKicker = document.querySelector<HTMLElement>("#eutherdogs-menu-kicker")!;
const eutherDogsMenuTitle = document.querySelector<HTMLElement>("#eutherdogs-menu-title")!;
const eutherDogsMenuCash = document.querySelector<HTMLElement>("#eutherdogs-menu-cash")!;
const eutherDogsMenuBody = document.querySelector<HTMLDivElement>("#eutherdogs-menu-body")!;
const eutherDogsLoadingOverlay = document.querySelector<HTMLDivElement>("#eutherdogs-loading-overlay")!;
const eutherDogsLoadingPercent = document.querySelector<HTMLElement>("#eutherdogs-loading-percent")!;
const eutherDogsLoadingMeter = document.querySelector<HTMLDivElement>(".eutherdogs-loading-overlay .eutherdogs-loading-meter")!;
const eutherDogsLoadingFill = document.querySelector<HTMLSpanElement>("#eutherdogs-loading-fill")!;
const eutherDogsLoadingLabel = document.querySelector<HTMLElement>("#eutherdogs-loading-label")!;
const eutherDogsLoadingDetail = document.querySelector<HTMLElement>("#eutherdogs-loading-detail")!;
const eutherDogsHud = document.querySelector<HTMLDivElement>("#eutherdogs-hud")!;
const eutherDogsInventoryPopup = document.querySelector<HTMLDivElement>("#eutherdogs-inventory-popup")!;
const eutherDogsInventoryTitle = document.querySelector<HTMLElement>("#eutherdogs-inventory-title")!;
const eutherDogsInventoryBody = document.querySelector<HTMLDivElement>("#eutherdogs-inventory-body")!;
const eutherDogsInventoryClose = document.querySelector<HTMLButtonElement>("#eutherdogs-inventory-close")!;
const eutherDogsStaffOpen = document.querySelector<HTMLButtonElement>("#eutherdogs-staff-open")!;
const eutherDogsStoreOpen = document.querySelector<HTMLButtonElement>("#eutherdogs-store-open")!;
const eutherDogsBriefingOpen = document.querySelector<HTMLButtonElement>("#eutherdogs-briefing-open")!;
const eutherDogsScoresOpen = document.querySelector<HTMLButtonElement>("#eutherdogs-scores-open")!;
const eutherDogsControlsOpen = document.querySelector<HTMLButtonElement>("#eutherdogs-controls-open")!;
const eutherDogsStartShift = document.querySelector<HTMLButtonElement>("#eutherdogs-start-shift")!;
const mobileToggle = document.querySelector<HTMLButtonElement>("#mobile-toggle")!;
const mobilePlay = document.querySelector<HTMLButtonElement>('[data-mobile-command="play"]')!;
const releaseBuild = document.querySelector<HTMLButtonElement>("#release-build")!;
const buildLamp = document.querySelector<HTMLSpanElement>("#build-lamp")!;
const controlsOpenButton = document.querySelector<HTMLButtonElement>("#controls-open")!;
const controlsModal = document.querySelector<HTMLDivElement>("#controls-modal")!;
const controlsModalHome = controlsModal.parentElement!;
const controlsEyebrow = controlsModal.querySelector<HTMLElement>(".eyebrow")!;
const controlsTitle = document.querySelector<HTMLElement>("#controls-title")!;
const controlsClose = document.querySelector<HTMLButtonElement>("#controls-close")!;
const controlsReset = document.querySelector<HTMLButtonElement>("#controls-reset")!;
const bindingRows = document.querySelector<HTMLDivElement>("#binding-rows")!;
const gamepadList = document.querySelector<HTMLDivElement>("#gamepad-list")!;
const captureReadout = document.querySelector<HTMLDivElement>("#capture-readout")!;
const buildProfileButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-build-profile]"),
);
const playerPortButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-player-port]"),
);

volumeSlider.value = Math.round(audioVolume * 100).toString();
micVolumeSlider.value = Math.round(micVolume * 100).toString();
applyUserAppearance();
applyEutherDogsCssAssets();
initializeShaderControls();
void loadShaderConfigFile();
void loadRomDirSetting();
void refreshLobby();
void refreshHostUsers();
updateVolumeUi();
updateMicVolumeUi();
updateDoomMouseSensitivityUi();
applyAudioVolume();
applyMobileMode();
renderDogsAssetMode();
renderPlayerPort();
renderVideoChat();
renderUserMenu();
renderInteractionUsers();
applyAppRoute();
volumeSlider.addEventListener("input", () => {
  setAudioVolume(Number(volumeSlider.value) / 100);
});

micVolumeSlider.addEventListener("input", () => {
  setMicVolume(Number(micVolumeSlider.value) / 100);
});

userMenuToggle.addEventListener("click", (event) => {
  event.stopPropagation();
  setUserMenuOpen(!userMenuOpen);
});

userSettingsToggle.addEventListener("click", (event) => {
  event.stopPropagation();
  setUserMenuOpen(false);
  openWorkspaceWindow("settings");
});

userMenuDropdown.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-user-menu-action]");
  if (!button) {
    return;
  }
  void handleUserMenuAction(button.dataset.userMenuAction ?? "");
});

reactionCorePage.addEventListener("click", (event) => {
  const lobbyAward = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-eutherium-lobby-award-submit]");
  if (lobbyAward) {
    void awardEutheriumFromLobby();
    return;
  }
  const routeButton = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-app-route]");
  if (routeButton && handleAppRouteButton(routeButton)) {
    return;
  }
  const workspaceButton = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-workspace-window]");
  if (workspaceButton && handleWorkspaceWindowButton(workspaceButton)) {
    return;
  }
  const reactionLobbyButton = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-reaction-home-action]");
  if (reactionLobbyButton) {
    void handleReactionLobbyHomeAction(reactionLobbyButton);
    return;
  }
  const modeButton = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-play-mode]");
  const mode = modeButton?.dataset.playMode;
  if (isPlayMode(mode)) {
    void activatePlayMode(mode);
  }
});

interactionLobbyPage.addEventListener("click", (event) => {
  const routeButton = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-app-route]");
  if (routeButton && handleAppRouteButton(routeButton)) {
    return;
  }
  const workspaceButton = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-workspace-window]");
  if (workspaceButton && handleWorkspaceWindowButton(workspaceButton)) {
    return;
  }
});

workspaceWindowClose.addEventListener("click", () => {
  closeWorkspaceWindow();
});

workspaceWindowDynamic.addEventListener("click", async (event) => {
  const target = event.target as HTMLElement;
  const socialRefresh = target.closest<HTMLButtonElement>("[data-social-chat-refresh]");
  if (socialRefresh) {
    await refreshActiveSocialChat("button", 0);
    return;
  }
  const settingsTheme = target.closest<HTMLButtonElement>("[data-settings-theme]");
  if (settingsTheme?.dataset.settingsTheme) {
    setUserTheme(normalizeUserTheme(settingsTheme.dataset.settingsTheme));
    renderWorkspaceWindow();
    return;
  }
  const settingsSkin = target.closest<HTMLButtonElement>("[data-settings-skin]");
  if (settingsSkin?.dataset.settingsSkin) {
    setUserSkin(normalizeUserSkin(settingsSkin.dataset.settingsSkin));
    renderWorkspaceWindow();
    return;
  }
  const settingsClearSkin = target.closest<HTMLButtonElement>("[data-settings-clear-custom-skin]");
  if (settingsClearSkin) {
    clearCustomUserSkin();
    renderWorkspaceWindow();
    return;
  }
  const socialSidebarToggle = target.closest<HTMLButtonElement>("[data-social-sidebar-toggle]");
  if (socialSidebarToggle) {
    socialChatSidebarCollapsed = !socialChatSidebarCollapsed;
    renderActiveSocialChatWindow();
    return;
  }
  const socialBackToList = target.closest<HTMLButtonElement>("[data-social-back-to-list]");
  if (socialBackToList) {
    socialChatSelectedConversationId = null;
    socialChatMessages = [];
    socialChatHasOlder = false;
    socialChatSidebarCollapsed = false;
    socialChatThreadDetailsExpanded = false;
    renderActiveSocialChatWindow();
    return;
  }
  const socialThreadDetails = target.closest<HTMLButtonElement>("[data-social-thread-details]");
  if (socialThreadDetails) {
    socialChatThreadDetailsExpanded = !socialChatThreadDetailsExpanded;
    renderActiveSocialChatWindow();
    return;
  }
  const socialConversation = target.closest<HTMLButtonElement>("[data-social-conversation]");
  if (socialConversation?.dataset.socialConversation) {
    await selectSocialChatConversation(socialConversation.dataset.socialConversation);
    return;
  }
  const socialUser = target.closest<HTMLButtonElement>("[data-social-user]");
  if (socialUser?.dataset.socialUser) {
    toggleSocialChatUser(socialUser.dataset.socialUser);
    return;
  }
  const socialCreate = target.closest<HTMLButtonElement>("[data-social-create-chat]");
  if (socialCreate) {
    await createSocialChatFromSelection();
    return;
  }
  const socialLoadOlder = target.closest<HTMLButtonElement>("[data-social-load-older]");
  if (socialLoadOlder) {
    await loadOlderSocialChatMessages();
    return;
  }
  const socialRemoveAttachment = target.closest<HTMLButtonElement>("[data-social-remove-attachment]");
  if (socialRemoveAttachment?.dataset.socialRemoveAttachment) {
    removeSocialChatPendingAttachment(socialRemoveAttachment.dataset.socialRemoveAttachment);
    return;
  }
  const socialEmojiToggle = target.closest<HTMLButtonElement>("[data-social-emoji-toggle]");
  if (socialEmojiToggle) {
    socialChatEmojiPickerOpen = !socialChatEmojiPickerOpen;
    renderActiveSocialChatWindow();
    return;
  }
  const socialEmoji = target.closest<HTMLButtonElement>("[data-social-emoji]");
  if (socialEmoji?.dataset.socialEmoji) {
    insertSocialChatEmoji(socialEmoji.dataset.socialEmoji);
    return;
  }
  const socialReactionButton = target.closest<HTMLButtonElement>("[data-social-reaction-key]");
  if (socialReactionButton?.dataset.socialReactionKey && socialReactionButton.dataset.socialReactionMessage) {
    void toggleSocialMessageReaction(
      Number(socialReactionButton.dataset.socialReactionMessage),
      socialReactionButton.dataset.socialReactionKey,
    );
    return;
  }
  const booksRefresh = target.closest<HTMLButtonElement>("[data-eutherbooks-refresh]");
  if (booksRefresh) {
    await loadEutherBooks(true);
    return;
  }
  const booksUpload = target.closest<HTMLButtonElement>("[data-eutherbooks-upload]");
  if (booksUpload) {
    workspaceWindowDynamic.querySelector<HTMLInputElement>("[data-eutherbooks-upload-input]")?.click();
    return;
  }
  const booksBook = target.closest<HTMLButtonElement>("[data-eutherbooks-book]");
  if (booksBook?.dataset.eutherbooksBook) {
    await selectEutherBook(booksBook.dataset.eutherbooksBook);
    return;
  }
  const booksTts = target.closest<HTMLButtonElement>("[data-eutherbooks-tts]");
  if (booksTts) {
    await startEutherBooksTts(selectedEutherBookChapterIndex, true, "Generating speech");
    return;
  }
  const booksResume = target.closest<HTMLButtonElement>("[data-eutherbooks-resume]");
  if (booksResume) {
    await resumeEutherBooksBookmark();
    return;
  }
  const booksBookmark = target.closest<HTMLButtonElement>("[data-eutherbooks-bookmark]");
  if (booksBookmark) {
    saveEutherBooksBookmark("manual");
    renderBooksWindowIfActive();
    return;
  }
  const booksAutoAdvance = target.closest<HTMLButtonElement>("[data-eutherbooks-auto-advance]");
  if (booksAutoAdvance) {
    setEutherBooksAutoAdvance(!eutherBooksAutoAdvance);
    return;
  }
  const booksAutoGenerate = target.closest<HTMLButtonElement>("[data-eutherbooks-auto-generate]");
  if (booksAutoGenerate) {
    setEutherBooksAutoGenerateNext(!eutherBooksAutoGenerateNext);
    return;
  }
  const voiceChoice = target.closest<HTMLButtonElement>("[data-eutherbooks-voice-choice]");
  if (voiceChoice?.dataset.eutherbooksVoiceChoice) {
    selectedEutherBooksVoice = voiceChoice.dataset.eutherbooksVoiceChoice;
    normalizeSelectedEutherBooksVoice();
    if (eutherBooksIsOwnVoiceSelection() || selectedEutherBooksVoice === "custom") {
      eutherBooksVoiceSettingsOpen = true;
    }
    localStorage.setItem("eutherbooks-voice", selectedEutherBooksVoice);
    applyEutherBooksSelectedVoiceDefaults();
    resetEutherBooksSelectionAudio();
    scheduleUserPreferencesSave();
    renderWorkspaceWindow();
    return;
  }
  const voiceRecord = target.closest<HTMLButtonElement>("[data-eutherbooks-record-voice]");
  if (voiceRecord) {
    openEutherBooksVoiceSampleDialog();
    return;
  }
  const voiceDialogClose = target.closest<HTMLButtonElement>("[data-eutherbooks-voice-dialog-close]");
  if (voiceDialogClose) {
    closeEutherBooksVoiceSampleDialog();
    return;
  }
  const voiceDialogRecord = target.closest<HTMLButtonElement>("[data-eutherbooks-dialog-record-voice]");
  if (voiceDialogRecord) {
    await startEutherBooksVoiceRecording();
    return;
  }
  const voicePick = target.closest<HTMLButtonElement>("[data-eutherbooks-pick-voice]");
  if (voicePick) {
    openEutherBooksVoiceSamplePicker();
    return;
  }
  const voiceStop = target.closest<HTMLButtonElement>("[data-eutherbooks-stop-voice]");
  if (voiceStop) {
    stopEutherBooksVoiceRecording();
    return;
  }
  const voiceSave = target.closest<HTMLButtonElement>("[data-eutherbooks-save-voice]");
  if (voiceSave) {
    await saveEutherBooksOwnVoiceSample();
    return;
  }
  const voiceReplay = target.closest<HTMLButtonElement>("[data-eutherbooks-replay-voice]");
  if (voiceReplay) {
    await replayEutherBooksLockedVoiceSample();
    return;
  }
  const booksPrev = target.closest<HTMLButtonElement>("[data-eutherbooks-prev-audio]");
  if (booksPrev) {
    const job = currentEutherBooksPlaybackJob();
    if (eutherBooksUsesWebAudioPlayback(job)) {
      seekEutherBooksVirtualTime(Math.max(0, eutherBooksVirtualCurrentTime(job, null) - 15), isEutherBooksAudioPlaying());
    } else {
      setEutherBooksAudioIndex(eutherBooksAudioIndex - 1);
    }
    return;
  }
  const booksNext = target.closest<HTMLButtonElement>("[data-eutherbooks-next-audio]");
  if (booksNext) {
    const job = currentEutherBooksPlaybackJob();
    if (eutherBooksUsesWebAudioPlayback(job)) {
      const total = eutherBooksVirtualTotalDuration(job);
      seekEutherBooksVirtualTime(Math.min(Math.max(0, total - 0.2), eutherBooksVirtualCurrentTime(job, null) + 15), isEutherBooksAudioPlaying());
    } else {
      setEutherBooksAudioIndex(eutherBooksAudioIndex + 1);
    }
    return;
  }
  const booksWebAudioToggle = target.closest<HTMLButtonElement>("[data-eutherbooks-web-audio-toggle]");
  if (booksWebAudioToggle) {
    await toggleEutherBooksWebAudioPlayback();
    return;
  }
  const booksPlaybackDebug = target.closest<HTMLButtonElement>("[data-eutherbooks-playback-debug-toggle]");
  if (booksPlaybackDebug) {
    eutherBooksPlaybackDebugOpen = !eutherBooksPlaybackDebugOpen;
    localStorage.setItem("eutherbooks-playback-debug", String(eutherBooksPlaybackDebugOpen));
    renderWorkspaceWindow();
    return;
  }
  const refresh = target.closest<HTMLButtonElement>("[data-eutherium-refresh]");
  if (refresh) {
    await loadEutherium(true);
    return;
  }
  const buy = target.closest<HTMLButtonElement>("[data-eutherium-buy]");
  if (buy) {
    await buyEutheriumItem(buy.dataset.eutheriumBuy ?? "");
    return;
  }
  const award = target.closest<HTMLButtonElement>("[data-eutherium-award-submit]");
  if (award) {
    await awardEutheriumFromWorkspace();
    return;
  }
  const place = target.closest<HTMLButtonElement>("[data-trophy-place]");
  if (place) {
    await placeTrophyItem(place.dataset.trophyPlace ?? "");
    return;
  }
  const select = target.closest<HTMLButtonElement>("[data-trophy-select]");
  if (select) {
    selectedTrophyInventoryId = select.dataset.trophySelect ?? null;
    renderWorkspaceWindow();
    return;
  }
  const move = target.closest<HTMLButtonElement>("[data-trophy-move]");
  if (move) {
    await moveSelectedTrophy(move.dataset.trophyMove ?? "");
    return;
  }
});

workspaceWindowDynamic.addEventListener("change", (event) => {
  const socialImageInput = (event.target as HTMLElement).closest<HTMLInputElement>("[data-social-image-input]");
  if (socialImageInput?.files?.length) {
    void uploadSocialChatFiles([...socialImageInput.files]);
    socialImageInput.value = "";
    return;
  }
  const socialCameraInput = (event.target as HTMLElement).closest<HTMLInputElement>("[data-social-camera-input]");
  if (socialCameraInput?.files?.length) {
    void postSocialChatCameraFiles([...socialCameraInput.files]);
    socialCameraInput.value = "";
    return;
  }
  const customSkinInput = (event.target as HTMLElement).closest<HTMLInputElement>("[data-settings-custom-skin-input]");
  if (customSkinInput?.files?.length) {
    void loadCustomUserSkin(customSkinInput.files[0]);
    customSkinInput.value = "";
    return;
  }
  const socialReactionSelect = (event.target as HTMLElement).closest<HTMLSelectElement>("[data-social-reaction-select]");
  if (socialReactionSelect?.dataset.socialReactionSelect && socialReactionSelect.value) {
    void toggleSocialMessageReaction(Number(socialReactionSelect.dataset.socialReactionSelect), socialReactionSelect.value);
    socialReactionSelect.value = "";
    return;
  }
  const booksUploadInput = (event.target as HTMLElement).closest<HTMLInputElement>("[data-eutherbooks-upload-input]");
  if (booksUploadInput?.files?.length) {
    void uploadEutherBooksFiles([...booksUploadInput.files]);
    booksUploadInput.value = "";
    return;
  }
  const voiceSampleInput = (event.target as HTMLElement).closest<HTMLInputElement>("[data-eutherbooks-voice-sample-input]");
  if (voiceSampleInput?.files?.length) {
    void useEutherBooksVoiceSampleFile(voiceSampleInput.files[0]);
    voiceSampleInput.value = "";
    return;
  }
  const bookSelect = (event.target as HTMLElement).closest<HTMLSelectElement>("[data-eutherbooks-book-select]");
  if (bookSelect?.value) {
    void selectEutherBook(bookSelect.value);
    return;
  }
  const voiceSelect = (event.target as HTMLElement).closest<HTMLSelectElement>("[data-eutherbooks-voice]");
  if (voiceSelect?.value) {
    selectedEutherBooksVoice = voiceSelect.value;
    normalizeSelectedEutherBooksVoice();
    if (eutherBooksIsOwnVoiceSelection() || selectedEutherBooksVoice === "custom") {
      eutherBooksVoiceSettingsOpen = true;
    }
    localStorage.setItem("eutherbooks-voice", selectedEutherBooksVoice);
    applyEutherBooksSelectedVoiceDefaults();
    resetEutherBooksSelectionAudio();
    scheduleUserPreferencesSave();
    renderWorkspaceWindow();
    return;
  }
  const modelSelect = (event.target as HTMLElement).closest<HTMLSelectElement>("[data-eutherbooks-model]");
  if (modelSelect?.value) {
    selectedEutherBooksModelBackend = normalizeEutherBooksModelBackend(modelSelect.value);
    eutherBooksVoicePickerScrollTop = 0;
    selectEutherBooksVoiceForModelBackend();
    persistEutherBooksModelBackend();
    localStorage.setItem("eutherbooks-voice", selectedEutherBooksVoice);
    applyEutherBooksSelectedVoiceDefaults();
    resetEutherBooksSelectionAudio();
    scheduleUserPreferencesSave();
    renderWorkspaceWindow();
    return;
  }
  const customVoiceInput = (event.target as HTMLElement).closest<HTMLInputElement>("[data-eutherbooks-custom-voice]");
  if (customVoiceInput) {
    setEutherBooksCustomVoicePrompt(customVoiceInput.value);
    return;
  }
  const virtualSeek = (event.target as HTMLElement).closest<HTMLInputElement>("[data-eutherbooks-virtual-seek]");
  if (virtualSeek) {
    seekEutherBooksVirtualTime(Number(virtualSeek.value), isEutherBooksAudioPlaying());
    return;
  }
  const audioSelect = (event.target as HTMLElement).closest<HTMLSelectElement>("[data-eutherbooks-audio-select]");
  if (audioSelect) {
    setEutherBooksAudioIndex(Number(audioSelect.value), true);
    return;
  }
  const sleepTimerSelect = (event.target as HTMLElement).closest<HTMLSelectElement>("[data-eutherbooks-sleep-timer]");
  if (sleepTimerSelect) {
    setEutherBooksSleepTimer(sleepTimerSelect.value);
    return;
  }
  const optionInput = (event.target as HTMLElement).closest<HTMLInputElement>("[data-eutherbooks-option]");
  if (optionInput) {
    setEutherBooksOption(optionInput.dataset.eutherbooksOption ?? "", Number(optionInput.value));
    return;
  }
  const chapterSelect = (event.target as HTMLElement).closest<HTMLSelectElement>("[data-eutherbooks-chapter]");
  if (!chapterSelect) {
    return;
  }
  selectedEutherBookChapterIndex = Number(chapterSelect.value);
  persistEutherBooksSelectionPreference();
  eutherBooksJob = null;
  eutherBooksPlayableFallbackJob = null;
  eutherBooksAudioIndex = 0;
  eutherBooksPendingAutoplayJobId = null;
  eutherBooksBufferedAutoplayJobId = null;
  eutherBooksPrefetchJobs = [];
  clearEutherBooksPrefetchPoll();
  setEutherBooksPlaybackState("idle", "");
  renderWorkspaceWindow();
  void attachEutherBooksJobForSelection();
});

workspaceWindowDynamic.addEventListener("submit", (event) => {
  const form = (event.target as HTMLElement).closest<HTMLFormElement>("[data-social-chat-form]");
  if (!form) {
    return;
  }
  event.preventDefault();
  void sendSocialChatMessage();
});

workspaceWindowDynamic.addEventListener(
  "toggle",
  (event) => {
    const settings = (event.target as HTMLElement).closest<HTMLDetailsElement>("[data-eutherbooks-voice-settings]");
    if (!settings || activeWorkspaceWindow !== "books") {
      return;
    }
    eutherBooksVoiceSettingsOpen = settings.open;
  },
  true,
);

workspaceWindowDynamic.addEventListener("input", (event) => {
  const customVoiceInput = (event.target as HTMLElement).closest<HTMLInputElement>("[data-eutherbooks-custom-voice]");
  if (customVoiceInput) {
    setEutherBooksCustomVoicePrompt(customVoiceInput.value);
    return;
  }
  const virtualSeek = (event.target as HTMLElement).closest<HTMLInputElement>("[data-eutherbooks-virtual-seek]");
  if (virtualSeek) {
    seekEutherBooksVirtualTime(Number(virtualSeek.value), isEutherBooksAudioPlaying());
    return;
  }
  const search = (event.target as HTMLElement).closest<HTMLInputElement>("[data-social-user-search]");
  if (!search) {
    return;
  }
  socialChatSearchQuery = search.value;
  void searchSocialChatUsers();
});

workspaceWindowDynamic.addEventListener("paste", (event) => {
  if (activeWorkspaceWindow !== "interaction") {
    return;
  }
  const files = [...(event.clipboardData?.files ?? [])].filter((file) => file.type.startsWith("image/"));
  if (files.length === 0) {
    return;
  }
  event.preventDefault();
  void uploadSocialChatFiles(files);
});

workspaceWindowDynamic.addEventListener("scroll", (event) => {
  const voicePicker = (event.target as HTMLElement).closest<HTMLDivElement>(".eutherbooks-voice-picker-groups");
  if (voicePicker && activeWorkspaceWindow === "books") {
    eutherBooksVoicePickerScrollTop = voicePicker.scrollTop;
    return;
  }
  const messageList = (event.target as HTMLElement).closest<HTMLDivElement>(".social-message-list");
  if (!messageList || activeWorkspaceWindow !== "interaction" || messageList.scrollTop > 0) {
    return;
  }
  void refreshActiveSocialChat("top-scroll", 1800);
}, true);

workspaceWindowDynamic.addEventListener(
  "ended",
  (event) => {
    const audio = (event.target as HTMLElement).closest<HTMLAudioElement>("audio");
    if (!audio || activeWorkspaceWindow !== "books") {
      return;
    }
    void handleEutherBooksAudioEnded();
  },
  true,
);

workspaceWindowDynamic.addEventListener(
  "pause",
  (event) => {
    const audio = (event.target as HTMLElement).closest<HTMLAudioElement>("audio");
    if (!audio || activeWorkspaceWindow !== "books" || audio.ended) {
      return;
    }
    saveEutherBooksBookmark("pause");
  },
  true,
);

workspaceWindowDynamic.addEventListener(
  "error",
  (event) => {
    const audio = (event.target as HTMLElement).closest<HTMLAudioElement>("audio");
    if (!audio || activeWorkspaceWindow !== "books") {
      return;
    }
    setEutherBooksPlaybackState("error", eutherBooksAudioErrorMessage(audio.error));
    renderBooksWindowIfActive();
  },
  true,
);

workspaceWindowDynamic.addEventListener(
  "timeupdate",
  (event) => {
    const audio = (event.target as HTMLElement).closest<HTMLAudioElement>("audio");
    if (!audio || activeWorkspaceWindow !== "books") {
      return;
    }
    const job = currentEutherBooksPlaybackJob();
    const path = job?.audio_files[eutherBooksAudioIndex];
    if (path && Number.isFinite(audio.duration) && audio.duration > 0) {
      eutherBooksAudioDurationCache.set(path, audio.duration);
    }
    maybePrefetchEutherBooksNextChapter();
    updateEutherBooksVirtualPlayerDom(audio);
  },
  true,
);

workspaceWindowDynamic.addEventListener(
  "loadedmetadata",
  (event) => {
    const audio = (event.target as HTMLElement).closest<HTMLAudioElement>("audio");
    if (!audio || activeWorkspaceWindow !== "books") {
      return;
    }
    updateEutherBooksVirtualPlayerDom(audio);
  },
  true,
);

workspaceWindowDynamic.addEventListener("pointerdown", (event) => {
  const target = event.target as HTMLElement;
  const messageList = target.closest<HTMLDivElement>(".social-message-list");
  if (messageList && activeWorkspaceWindow === "interaction" && messageList.scrollTop <= 0) {
    socialChatPullStartY = event.clientY;
    socialChatPullTriggered = false;
  }
  const trophy = target.closest<HTMLButtonElement>("[data-trophy-select]");
  if (!trophy) {
    return;
  }
  startTrophyDrag(event, trophy);
});

workspaceWindowDynamic.addEventListener("pointermove", (event) => {
  if (
    socialChatPullStartY !== null
    && !socialChatPullTriggered
    && activeWorkspaceWindow === "interaction"
    && event.clientY - socialChatPullStartY > 58
  ) {
    socialChatPullTriggered = true;
    void refreshActiveSocialChat("pull-top", 1200);
  }
  updateTrophyDrag(event);
});

workspaceWindowDynamic.addEventListener("pointerup", (event) => {
  socialChatPullStartY = null;
  socialChatPullTriggered = false;
  void finishTrophyDrag(event);
});

workspaceWindowDynamic.addEventListener("pointercancel", () => {
  socialChatPullStartY = null;
  socialChatPullTriggered = false;
  trophyDrag = null;
});

window.addEventListener("focus", () => {
  void refreshActiveSocialChat("focus", 2500);
  void recoverEutherBooksPlaybackAfterPageResume("focus");
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    void refreshActiveSocialChat("visible", 2500);
    void recoverEutherBooksPlaybackAfterPageResume("visible");
  }
});

window.addEventListener("pageshow", () => {
  void recoverEutherBooksPlaybackAfterPageResume("pageshow");
});

workspaceWindowLayer.addEventListener("click", (event) => {
  const audioResume = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-settings-audio-resume]");
  if (audioResume) {
    void unlockAudioFromSettings();
    return;
  }
  const workspaceButton = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-workspace-window]");
  if (workspaceButton && handleWorkspaceWindowButton(workspaceButton)) {
    return;
  }
  if (event.target === workspaceWindowLayer) {
    closeWorkspaceWindow();
  }
});

workspaceWindowLayer.addEventListener("input", (event) => {
  const slider = (event.target as HTMLElement).closest<HTMLInputElement>("[data-settings-audio-slider]");
  if (!slider) {
    return;
  }
  if (slider.dataset.settingsAudioSlider === "volume") {
    setAudioVolume(Number(slider.value) / 100);
  } else if (slider.dataset.settingsAudioSlider === "mic") {
    setMicVolume(Number(slider.value) / 100);
  }
});

shoppingListItems.addEventListener("change", (event) => {
  const checkbox = (event.target as HTMLElement).closest<HTMLInputElement>("[data-shopping-line]");
  if (!checkbox) {
    return;
  }
  setShoppingListItemChecked(Number(checkbox.dataset.shoppingLine), checkbox.checked);
});

shoppingListItems.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-shopping-remove]");
  if (!button) {
    return;
  }
  removeShoppingListItem(Number(button.dataset.shoppingRemove));
});

shoppingListAddForm.addEventListener("submit", (event) => {
  event.preventDefault();
  addShoppingListItem(shoppingListAddInput.value);
});

shoppingShareForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void shareShoppingList();
});

shoppingListMembersEl.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-shopping-unshare]");
  if (!button?.dataset.shoppingUnshare) {
    return;
  }
  void unshareShoppingList(button.dataset.shoppingUnshare);
});

shoppingListMembersEl.addEventListener("change", (event) => {
  const select = (event.target as HTMLElement).closest<HTMLSelectElement>("[data-shopping-role-user]");
  if (!select?.dataset.shoppingRoleUser) {
    return;
  }
  void updateShoppingListMemberRole(select.dataset.shoppingRoleUser, select.value);
});

shoppingListMarkdownInput.addEventListener("input", () => {
  if (!shoppingListCanEdit) {
    shoppingListMarkdownInput.value = shoppingListMarkdown;
    return;
  }
  shoppingListMarkdown = shoppingListMarkdownInput.value;
  shoppingListStatus = "Edited";
  renderShoppingListItems();
  scheduleShoppingListSave();
});

shoppingListSort.addEventListener("click", () => {
  smartSortShoppingList();
});

shoppingListSave.addEventListener("click", () => {
  void saveShoppingList();
});

window.addEventListener("hashchange", () => {
  applyAppRoute();
});

document.addEventListener("click", (event) => {
  if (userMenuOpen && !userMenu.contains(event.target as Node)) {
    setUserMenuOpen(false);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && activeWorkspaceWindow) {
    closeWorkspaceWindow();
    return;
  }
  if (event.key === "Escape" && userMenuOpen) {
    setUserMenuOpen(false);
  }
});

mobileToggle.addEventListener("click", () => {
  setMobileMode(!mobileMode);
});

dogsAssetModeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setDogsAssetMode(button.dataset.dogsAssetMode === "2x" ? "2x" : "classic");
  });
});

playerPortButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (claimedLobbyPlayer !== null) {
      setPlayerPort(claimedLobbyPlayer);
      pushTrace(`Player locked to claimed P${claimedLobbyPlayer}`);
      return;
    }
    setPlayerPort(button.dataset.playerPort === "2" ? 2 : 1);
  });
});

lobbyRefresh.addEventListener("click", () => {
  void refreshLobby();
});

lobbyInstances.addEventListener("click", async (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-instance-id]");
  if (!button) {
    return;
  }
  await selectLobbyInstance(button.dataset.instanceId ?? "main");
});

instanceStart.addEventListener("click", async () => {
  await startLobbyInstance("megadrive");
});

alertInstanceStart.addEventListener("click", async () => {
  await startEutherAlertAsServer();
});

doomInstanceStart.addEventListener("click", async () => {
  await startLobbyInstance("eutherdoom");
});

instanceJoin.addEventListener("click", async () => {
  await joinLobbyInstance();
});

claimP1.addEventListener("click", async () => {
  await joinLobbyInstance(1);
});

claimP2.addEventListener("click", async () => {
  await joinLobbyInstance(2);
});

releaseSlot.addEventListener("click", async () => {
  await releaseLobbySlot();
});

spectateInstance.addEventListener("click", async () => {
  await spectateActiveLobbyInstance();
});

kickP1.addEventListener("click", async () => {
  await kickLobbyPlayer(1);
});

kickP2.addEventListener("click", async () => {
  await kickLobbyPlayer(2);
});

closeInstance.addEventListener("click", async () => {
  await closeLobbyInstance();
});

doomRefresh.addEventListener("click", async () => {
  await refreshDoomStatus();
});

doomReady.addEventListener("click", async () => {
  await setDoomReady(true);
});

doomUnready.addEventListener("click", async () => {
  await setDoomReady(false);
});

doomReplay.addEventListener("click", async () => {
  await downloadDoomReplay();
});

doomSend.addEventListener("click", async () => {
  await sendDoomCommand();
});

doomDrive.addEventListener("click", () => {
  setDoomDriveActive(doomDriveTimer === null);
});

doomMouseSensitivityInput.addEventListener("input", () => {
  setDoomMouseSensitivity(Number(doomMouseSensitivityInput.value));
});

doomReset.addEventListener("click", async () => {
  await resetDoomMatch();
});

eutherAlertOpenRaStart.addEventListener("click", async () => {
  await startEutherAlertOpenRa();
});

eutherAlertOpenRaClientStart.addEventListener("click", async () => {
  await startEutherAlertOpenRaClient();
});

eutherAlertOpenRaClientStop.addEventListener("click", async () => {
  await stopEutherAlertOpenRaClient();
});

eutherAlertOpenRaDebug.addEventListener("click", async () => {
  await dumpEutherAlertOpenRaDebug();
});

eutherAlertOpenRaStop.addEventListener("click", async () => {
  await stopEutherAlertOpenRa();
});

eutherAlertFullscreen.addEventListener("click", async () => {
  await requestEutherAlertFullscreen();
});

eutherAlertBack.addEventListener("click", () => {
  navigateApp("playHome");
});

eutherAlertLobby.addEventListener("click", () => {
  navigateApp("interactionLobby");
});

adminOpen.addEventListener("click", async () => {
  await openAdminModal();
});

adminClose.addEventListener("click", () => {
  adminModal.classList.remove("is-open");
  adminModal.setAttribute("aria-hidden", "true");
});

adminRefresh.addEventListener("click", () => {
  void refreshHostUsers();
});

adminUserAdd.addEventListener("click", async () => {
  await addOrResetHostUser();
});

adminUsers.addEventListener("click", async (event) => {
  const target = event.target as HTMLElement;
  const select = target.closest<HTMLButtonElement>("[data-admin-select]");
  if (select) {
    selectedAdminUser = select.dataset.adminSelect ?? null;
    adminUsername.value = selectedAdminUser ?? "";
    adminPassword.value = "";
    renderHostUsers();
    return;
  }
  const adminButton = target.closest<HTMLButtonElement>("[data-admin-admin]");
  if (adminButton) {
    const username = adminButton.dataset.adminAdmin ?? "";
    const admin = adminButton.dataset.admin === "1";
    const result = await bridgeJson<HostUserList>(
      "/api/admin/users/admin",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ username, admin: String(admin) }),
      },
      1200,
    );
    hostUsers = result.users;
    selectedAdminUser = username;
    renderHostUsers();
    return;
  }
  const button = target.closest<HTMLButtonElement>("[data-admin-ban]");
  if (button) {
    const username = button.dataset.adminBan ?? "";
    const banned = button.dataset.banned === "1";
    const result = await bridgeJson<HostUserList>(
      "/api/admin/users/ban",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ username, banned: String(banned) }),
      },
      1200,
    );
    hostUsers = result.users;
    renderHostUsers();
    return;
  }
  const permissionButton = target.closest<HTMLButtonElement>("[data-admin-permission]");
  if (!permissionButton) {
    return;
  }
  const username = permissionButton.dataset.adminPermissionUser ?? "";
  const key = permissionButton.dataset.adminPermission as keyof HostPermissions;
  const user = hostUsers.find((entry) => entry.name === username);
  if (!user || !key) {
    return;
  }
  const next = { ...user.permissions, [key]: !user.permissions[key] };
  const result = await bridgeJson<HostUserList>(
    "/api/admin/users/permissions",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        username,
        can_play: String(next.canPlay),
        can_launch_roms: String(next.canLaunchRoms),
        can_upload_roms: String(next.canUploadRoms),
        can_manage_library: String(next.canManageLibrary),
        can_award_eutherium: String(next.canAwardEutherium),
      }),
    },
    1200,
  );
  hostUsers = result.users;
  selectedAdminUser = username;
  renderHostUsers();
});

inviteSend.addEventListener("click", async () => {
  await sendInvitePlaceholder();
});

adminAwardSend.addEventListener("click", async () => {
  await awardEutheriumFromAdminPanel();
});

perfToggle.addEventListener("click", () => {
  perfDrawer.classList.toggle("is-open");
});

videoChatToggle.addEventListener("click", () => {
  videoChatPanel.classList.toggle("is-collapsed");
});

videoChatWatch.addEventListener("click", async () => {
  await joinVideoChat(false);
});

videoChatCamera.addEventListener("click", async () => {
  await joinVideoChat(true);
});

videoChatMute.addEventListener("click", () => {
  toggleVideoChatMute();
});

videoChatLeave.addEventListener("click", async () => {
  await leaveVideoChat();
});

chatRefresh.addEventListener("click", () => {
  void refreshChat();
});

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await sendChatMessage();
});

shaderSelect.addEventListener("change", () => {
  setActiveShader(shaderSelect.value);
});

shaderToggle.addEventListener("click", () => {
  shaderDrawer.classList.toggle("is-open");
});

shaderControls.addEventListener("input", (event) => {
  const input = (event.target as HTMLElement).closest<HTMLInputElement>("[data-shader-param]");
  if (!input) {
    return;
  }
  const param = input.dataset.shaderParam as ShaderParamName;
  activeShaderParams[param] = Number(input.value);
  shaderConfig.presets[selectedShader][param] = activeShaderParams[param];
  const value = shaderControls.querySelector<HTMLElement>(`[data-shader-value="${param}"]`);
  if (value) {
    value.textContent = activeShaderParams[param].toFixed(2);
  }
  renderShaderFrame();
  scheduleShaderConfigSave();
});

romDrop.addEventListener("click", async (event) => {
  if (!isTauri) {
    return;
  }
  event.preventDefault();
  await chooseDesktopRom();
});

romInput.addEventListener("change", async () => {
  const file = romInput.files?.[0];
  if (file) {
    if (!canHostUploadRoms()) {
      pushTrace("ROM upload permission required");
      return;
    }
    await loadFile(file);
  }
});

romDirSet.addEventListener("click", async () => {
  if (isTauri) {
    const selected = await open({
      directory: true,
      multiple: false,
    });
    if (typeof selected === "string") {
      await setRomDir(selected);
    }
    return;
  }
  romDirManual.classList.toggle("is-open");
  romDirInput.focus();
});

romDirApply.addEventListener("click", async () => {
  await setRomDir(romDirInput.value);
});

romDirInput.addEventListener("keydown", async (event) => {
  if (event.key === "Enter") {
    await setRomDir(romDirInput.value);
  }
});

romList.addEventListener("click", async (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-rom-path]");
  if (!button) {
    return;
  }
  const path = button.dataset.romPath ?? "";
  if (button.dataset.romKind === "dir") {
    await refreshRomDir(path);
  } else {
    if (!canHostMutate()) {
      pushTrace("Host owner required");
      return;
    }
    await loadRomDirEntry(path, button.dataset.romName ?? basename(path));
  }
});

romDrop.addEventListener("dragover", (event) => {
  event.preventDefault();
  romDrop.classList.add("is-dragging");
});

romDrop.addEventListener("dragleave", () => {
  romDrop.classList.remove("is-dragging");
});

romDrop.addEventListener("drop", async (event) => {
  event.preventDefault();
  romDrop.classList.remove("is-dragging");
  const file = event.dataTransfer?.files?.[0];
  if (file) {
    if (!canHostUploadRoms()) {
      pushTrace("ROM upload permission required");
      return;
    }
    const filePath = tauriFilePath(file);
    if (isTauri && filePath) {
      await loadRomPath(filePath);
    } else {
      await loadFile(file);
    }
  }
});

playToggle.addEventListener("click", async () => {
  ui.playing = !ui.playing;
  playToggle.textContent = ui.playing ? "Pause" : "Play";
  ui.status = ui.playing ? "RUNNING" : "PAUSED";
  renderUi();
  if (civetMode) {
    ui.status = "CIVET BEVY";
    renderUi();
    return;
  }
  if (dogsMode) {
    if (ui.playing) {
      startDogsSnapshotStream();
      nextFrameDue = performance.now();
      void ensureAudio();
      void animationLoop();
    } else {
      stopDogsSnapshotStream();
    }
    return;
  }
  if (isTauri && ui.runtime === "tauri" && ui.loaded) {
    await invoke("set_native_running", { running: ui.playing });
    if (ui.playing) {
      void nativeStatusLoop();
    }
    return;
  }
  if (ui.runtime === "bridge" && ui.loaded) {
    if (ui.playing) {
      await startBridgePlayback();
    } else {
      stopBridgeStream();
    }
    return;
  }
  if (ui.playing) {
    nextFrameDue = performance.now();
    void ensureAudio();
    void animationLoop();
  }
});

stepFrame.addEventListener("click", async () => {
  if (civetMode) {
    ui.playing = false;
    playToggle.textContent = "Play";
    ui.status = "CIVET BEVY";
    renderUi();
    return;
  }
  if (isTauri && ui.runtime === "tauri") {
    ui.playing = false;
    playToggle.textContent = "Play";
    await invoke("set_native_running", { running: false });
  } else if (ui.runtime === "bridge") {
    ui.playing = false;
    playToggle.textContent = "Play";
    stopBridgeStream();
  }
  resetScheduledAudio();
  await advanceFrame();
});

resetCore.addEventListener("click", async () => {
  if (civetMode) {
    await resetCivetMode();
    return;
  }
  if (dogsMode) {
    resetDogsMode();
    return;
  }
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  let drewCoreFrame = false;
  if (isTauri && ui.runtime === "tauri" && ui.loaded) {
    ui.playing = false;
    playToggle.textContent = "Play";
    await invoke("set_native_running", { running: false });
    resetScheduledAudio();
    await invoke("reset_emulator");
  } else if (ui.runtime === "bridge" && ui.loaded) {
    ui.playing = false;
    playToggle.textContent = "Play";
    stopBridgeStream();
    const result = await bridgeJson<BridgeStatusResult>("/reset", {
      method: "POST",
    });
    Object.assign(ui, result);
    const frame = await bridgeFrame();
    drawNativeFrame(frame);
    ui.frame = frame.frame;
    ui.cpuCycles = frame.cpuCycles;
    ui.cpuSteps = frame.cpuSteps;
    ui.frameMs = frame.frameMs;
    drewCoreFrame = true;
  }
  if (!drewCoreFrame) {
    ui.frame = 0;
    ui.cpuCycles = 0;
    ui.cpuSteps = 0;
    drawSyntheticFrame();
  }
  ui.status = ui.loaded ? "RESET" : "IDLE";
  pushTrace("Reset vector reloaded");
  renderUi();
  resetCore.blur();
  window.scrollTo(scrollX, scrollY);
});

eutherDogsToggle.addEventListener("click", () => {
  if (dogsMode) {
    leaveDogsMode();
  } else {
    void enterDogsMode();
  }
});

eutherCivetReset.addEventListener("click", () => {
  void resetCivetMode();
});

eutherCivetStep.addEventListener("click", () => {
  ui.playing = false;
  playToggle.textContent = "Play";
  ui.status = "CIVET BEVY";
  renderUi();
});

eutherDogsStaffOpen.addEventListener("click", () => {
  showDogsMenu("staff");
});

eutherDogsStoreOpen.addEventListener("click", () => {
  showDogsMenu("store");
});

eutherDogsBriefingOpen.addEventListener("click", () => {
  showDogsMenu("briefing");
});

eutherDogsScoresOpen.addEventListener("click", () => {
  dogsSelectedHighScoreIndex = 0;
  dogsScoresReturnMode = dogsMenuMode && dogsMenuMode !== "scores" ? dogsMenuMode : "briefing";
  showDogsMenu("scores");
});

eutherDogsStartShift.addEventListener("click", () => {
  if (dogsMenuMode === "scores") {
    showDogsMenu(dogsScoresReturnMode);
    return;
  }
  if (dogsMenuMode === "result") {
    if (dogsFrame?.summary.status === "won") {
      if ((dogsFrame.summary.mission ?? selectedDogsMission) >= (dogsFrame.summary.maxMission ?? 10)) {
        showDogsMenu("staff");
        return;
      }
      void startDogsNextMission();
      return;
    }
    void retryDogsShift();
    return;
  }
  void startDogsShift();
});

eutherDogsInventoryClose.addEventListener("click", () => {
  hideDogsInventory();
});

eutherDogsInventoryPopup.addEventListener("pointerdown", (event) => {
  if (event.target === eutherDogsInventoryPopup) {
    hideDogsInventory();
  }
});

document.addEventListener(
  "keydown",
  (event) => {
    if (event.key !== "F11") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    void toggleScreenFullscreen();
  },
  true,
);

document.addEventListener("fullscreenchange", () => {
  if (document.fullscreenElement !== screenGlass) {
    screenGlass.classList.remove("is-app-fullscreen");
  }
});

eutherDogsMenuBody.addEventListener("click", (event) => {
  const initialButton = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-score-initial]");
  if (initialButton) {
    dogsHighscoreInitialIndex = Number(initialButton.dataset.scoreInitial) || 0;
    renderDogsMenu();
    return;
  }
  const initialStep = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-score-step]");
  if (initialStep) {
    stepDogsHighscoreInitial(Number(initialStep.dataset.scoreStep) || 1);
    renderDogsMenu();
    return;
  }
  const scoreSubmit = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-score-submit]");
  if (scoreSubmit) {
    void submitPendingDogsHighScore();
    return;
  }
  const scoreBack = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-score-back]");
  if (scoreBack) {
    showDogsMenu(dogsScoresReturnMode);
    return;
  }
  const scoreRow = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-score-row]");
  if (scoreRow) {
    dogsSelectedHighScoreIndex = Number(scoreRow.dataset.scoreRow) || 0;
    renderDogsMenu();
    return;
  }
  const staffButton = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-staff-id]");
  if (staffButton) {
    const staff = staffButton.dataset.staffId === "2" ? 2 : 1;
    void selectDogsStaff(staff);
    return;
  }
  const missionButton = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-dogs-mission]");
  if (missionButton) {
    void selectDogsMission(Number(missionButton.dataset.dogsMission) || 1);
    return;
  }
  const buyButton = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-store-buy]");
  if (buyButton) {
    if (!buyButton.disabled) void purchaseDogsStoreItem(buyButton.dataset.storeBuy ?? "");
    return;
  }
  const itemButton = (event.target as HTMLElement).closest<HTMLElement>("[data-store-item]");
  if (!itemButton) return;
  dogsStorePreviewItemId = itemButton.dataset.storeItem ?? dogsStorePreviewItemId;
  renderDogsMenu();
});

eutherDogsMenuBody.addEventListener("mouseover", (event) => {
  if ((event.target as HTMLElement).closest("[data-store-buy]")) return;
  const button = (event.target as HTMLElement).closest<HTMLElement>("[data-store-item]");
  if (!button || dogsMenuMode !== "store") return;
  const itemId = button.dataset.storeItem ?? null;
  if (itemId && dogsStorePreviewItemId !== itemId) {
    dogsStorePreviewItemId = itemId;
    renderDogsMenu();
  }
});

eutherDogsMenuBody.addEventListener("focusin", (event) => {
  if ((event.target as HTMLElement).closest("[data-store-buy]")) return;
  const button = (event.target as HTMLElement).closest<HTMLElement>("[data-store-item]");
  if (!button || dogsMenuMode !== "store") return;
  dogsStorePreviewItemId = button.dataset.storeItem ?? dogsStorePreviewItemId;
  renderDogsMenu();
});

eutherDogsMenuBody.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const buyButton = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-store-buy]");
  if (buyButton) return;
  const item = (event.target as HTMLElement).closest<HTMLElement>("[data-store-item]");
  if (!item || dogsMenuMode !== "store") return;
  dogsStorePreviewItemId = item.dataset.storeItem ?? dogsStorePreviewItemId;
  renderDogsMenu();
  event.preventDefault();
});

releaseBuild.addEventListener("click", async () => {
  await buildReleaseBinary();
});

buildProfileButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    const profile = button.dataset.buildProfile === "release" ? "release" : "debug";
    await setBridgeBuildProfile(profile);
  });
});

stateGrid.addEventListener("click", async (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    "[data-state-action]",
  );
  if (!button) {
    return;
  }
  const slot = Number(button.dataset.slot ?? 0);
  if (button.dataset.stateAction === "save") {
    if (!canHostMutate()) {
      return;
    }
    await saveStateSlot(slot);
  } else {
    if (!canHostMutate()) {
      return;
    }
    await loadStateSlot(slot);
  }
});

document.querySelectorAll<HTMLButtonElement>("[data-pad]").forEach((button) => {
  const name = button.dataset.pad as keyof InputState;
  const set = (pressed: boolean) => {
    pointerState[name] = pressed;
    recomputeInputState();
    button.classList.toggle("is-active", pressed);
  };
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    set(true);
  });
  button.addEventListener("pointerup", () => set(false));
  button.addEventListener("pointercancel", () => set(false));
  button.addEventListener("pointerleave", () => set(false));
});

document.querySelectorAll<HTMLButtonElement>("[data-mobile-command]").forEach((button) => {
  button.addEventListener("click", () => {
    const command = button.dataset.mobileCommand;
    if (command === "play") {
      playToggle.click();
    } else if (command === "reset") {
      resetCore.click();
    } else if (command === "controls") {
      openControls();
    }
  });
});

controlsOpenButton.addEventListener("click", () => openControls());
eutherDogsControlsOpen.addEventListener("click", () => openControls("dogs"));
controlsClose.addEventListener("click", () => closeControls());
controlsReset.addEventListener("click", () => {
  if (controlsScope === "dogs") {
    dogsControlBindings = cloneDefaultDogsBindings();
    storeDogsBindings();
  } else {
    controlBindings = cloneDefaultBindings();
    storeBindings();
  }
  captureTarget = null;
  captureMode = null;
  renderBindings();
});
controlsModal.addEventListener("pointerdown", (event) => {
  if (event.target === controlsModal) {
    closeControls();
  }
});

bindingRows.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-bind]");
  if (!button) {
    return;
  }
  captureTarget = button.dataset.input as InputName | DogsBindingName;
  captureMode = button.dataset.bind === "pad" ? "pad" : "key";
  renderBindings();
});

dogsCanvas.addEventListener("pointerdown", (event) => {
  if (!dogsMode || !dogsFrame || dogsInspectionAnswerRects.length === 0) {
    return;
  }
  const bounds = dogsCanvas.getBoundingClientRect();
  const x = (event.clientX - bounds.left) * (dogsCanvas.width / bounds.width);
  const y = (event.clientY - bounds.top) * (dogsCanvas.height / bounds.height);
  const hit = dogsInspectionAnswerRects.find((rect) =>
    x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h
  );
  if (!hit) {
    return;
  }
  event.preventDefault();
  void answerDogsInspection(hit.answer);
});

window.addEventListener("keydown", (event) => {
  if (controlsOpen && event.key === "Escape") {
    closeControls();
    event.preventDefault();
    return;
  }
  if (dogsInventoryOpen && event.key === "Escape") {
    hideDogsInventory();
    event.preventDefault();
    return;
  }
  if (isEditableEventTarget(event.target)) {
    return;
  }
  if (captureTarget && captureMode === "key") {
    event.preventDefault();
    if (controlsScope === "dogs") {
      dogsControlBindings[captureTarget as DogsBindingName].key = event.key;
      storeDogsBindings();
    } else {
      controlBindings[captureTarget as InputName].key = event.key;
      storeBindings();
    }
    captureTarget = null;
    captureMode = null;
    renderBindings();
    return;
  }
  if (dogsMode && dogsFrame && dogsActionMatchesKey("map", event.key)) {
    dogsMapOpen = true;
    drawDogsFrame(dogsFrame);
    event.preventDefault();
    return;
  }
  if (dogsMode && dogsActionMatchesKey("inventory", event.key)) {
    event.preventDefault();
    toggleDogsInventory();
    return;
  }
  const dogsWeaponSlot = dogsWeaponSlotForKey(event);
  if (dogsWeaponSlot !== null) {
    event.preventDefault();
    if (!event.repeat) {
      void syncDogsWeaponSlot(dogsWeaponSlot);
    }
    return;
  }
  if (dogsMode && dogsFrame && !event.repeat) {
    const answer = dogsInspectionAnswerForKey(event.key);
    if (answer) {
      event.preventDefault();
      void answerDogsInspection(answer);
      return;
    }
  }
  const key = dogsMode ? dogsInputKeyForEvent(event.key) : keyForEvent(event.key);
  if (!key || keyboardState[key]) {
    return;
  }
  event.preventDefault();
  keyboardState[key] = true;
  recomputeInputState();
});

window.addEventListener("keyup", (event) => {
  if (isEditableEventTarget(event.target)) {
    return;
  }
  if (dogsMode && dogsActionMatchesKey("map", event.key) && dogsMapOpen) {
    dogsMapOpen = false;
    if (dogsMode && dogsFrame) drawDogsFrame(dogsFrame);
    event.preventDefault();
    return;
  }
  const key = dogsMode ? dogsInputKeyForEvent(event.key) : keyForEvent(event.key);
  if (!key) {
    return;
  }
  event.preventDefault();
  keyboardState[key] = false;
  recomputeInputState();
});

function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}

async function toggleScreenFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement === screenGlass) {
      await document.exitFullscreen();
      screenGlass.classList.remove("is-app-fullscreen");
      return;
    }
    if (screenGlass.classList.contains("is-app-fullscreen")) {
      screenGlass.classList.remove("is-app-fullscreen");
      return;
    }
    const requestFullscreen =
      screenGlass.requestFullscreen?.bind(screenGlass) ??
      (screenGlass as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void }).webkitRequestFullscreen?.bind(screenGlass);
    if (requestFullscreen) {
      await requestFullscreen();
      if (document.fullscreenElement === screenGlass) {
        return;
      }
    }
  } catch (err) {
    pushTrace(`Fullscreen missed: ${err instanceof Error ? err.message : String(err)}`);
  }
  screenGlass.classList.add("is-app-fullscreen");
}

function dogsWeaponSlotForKey(event: KeyboardEvent): number | null {
  if (!dogsMode || !dogsFrame || event.ctrlKey || event.altKey || event.metaKey) {
    return null;
  }
  for (let slot = 0; slot < 5; slot += 1) {
    if (dogsActionMatchesKey(`weapon${slot + 1}` as DogsBindingName, event.key)) {
      return slot;
    }
  }
  return null;
}

function dogsActionMatchesKey(action: DogsBindingName, key: string): boolean {
  return dogsControlBindings[action]?.key === key;
}

function dogsInspectionAnswerForKey(key: string): "yes" | "no" | "other" | null {
  if (!dogsFrame) {
    return null;
  }
  const dialogue = dogsLocalInspectionDialogue(dogsFrame);
  if (!dialogue || dialogue.complete) {
    return null;
  }
  if (dogsActionMatchesKey("answerYes", key)) {
    return "yes";
  }
  if (dogsActionMatchesKey("answerNo", key)) {
    return "no";
  }
  if (dogsActionMatchesKey("answerOther", key)) {
    return "other";
  }
  return null;
}

function emptyInputState(): InputState {
  return {
    up: false,
    down: false,
    left: false,
    right: false,
    a: false,
    b: false,
    c: false,
    start: false,
  };
}

function keyForEvent(key: string): InputName | null {
  return inputNames.find((name) => controlBindings[name].key === key) ?? null;
}

function dogsInputKeyForEvent(key: string): InputName | null {
  return inputNames.find((name) => dogsControlBindings[name].key === key) ?? null;
}

function recomputeInputState(): void {
  for (const name of inputNames) {
    inputState[name] = keyboardState[name] || pointerState[name] || gamepadState[name];
  }
  updatePadButtons();
  void syncInput();
}

async function loadRomDirSetting(): Promise<void> {
  try {
    const setting = isTauri
      ? await invoke<RomDirSetting>("get_rom_dir")
      : ui.runtime === "bridge"
        ? await bridgeJson<RomDirSetting>("/rom-dir", {}, 400)
        : { romDir: null };
    romDirRoot = setting.romDir ?? null;
    romDirInput.value = romDirRoot ?? "";
    if (romDirRoot) {
      await refreshRomDir("");
    } else {
      renderRomDir();
    }
  } catch {
    renderRomDir();
  }
}

async function setRomDir(path: string): Promise<void> {
  const trimmed = path.trim();
  if (!trimmed) {
    return;
  }
  if (!isTauri && !canHostManageLibrary()) {
    pushTrace("Library permission required");
    return;
  }
  try {
    const setting = isTauri
      ? await invoke<RomDirSetting>("set_rom_dir", { path: trimmed })
      : await bridgeJson<RomDirSetting>(
          "/rom-dir",
          {
            method: "POST",
            headers: { "Content-Type": "text/plain; charset=utf-8" },
            body: trimmed,
          },
        );
    romDirRoot = setting.romDir ?? trimmed;
    romDirInput.value = romDirRoot;
    romDirManual.classList.remove("is-open");
    await refreshRomDir("");
    pushTrace("ROM directory bonded");
  } catch (err) {
    pushTrace(`ROM directory rejected: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function refreshRomDir(path: string): Promise<void> {
  try {
    const listing = isTauri
      ? await invoke<RomDirListing>("list_rom_dir", { relativePath: path })
      : await bridgeJson<RomDirListing>(
          `/rom-dir/list?path=${encodeURIComponent(path)}`,
          {},
          700,
        );
    romDirRoot = listing.romDir ?? romDirRoot;
    romDirPath = listing.path;
    romDirEntries = listing.entries;
    renderRomDir(listing.parent ?? null);
  } catch (err) {
    romDirEntries = [];
    renderRomDir();
    pushTrace(`ROM directory read missed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function loadRomDirEntry(path: string, name: string): Promise<void> {
  if (dogsMode) {
    leaveDogsMode();
  }
  updateStartupModePreference("megadrive");
  ui.playing = false;
  playToggle.textContent = "Play";
  stopBridgeStream();
  try {
    if (isTauri) {
      const result = await invoke<LoadResult>("load_rom_from_dir", { relativePath: path });
      await applyLoadedRomResult(result, name, "tauri");
    } else {
      const result = await bridgeJson<BridgeStatusResult>(
        `/rom-dir/load?path=${encodeURIComponent(path)}`,
        { method: "POST" },
      );
      await applyLoadedRomResult(result, name, "bridge");
      const frame = await bridgeFrame();
      drawNativeFrame(frame);
      ui.frame = frame.frame;
      ui.cpuCycles = frame.cpuCycles;
      ui.cpuSteps = frame.cpuSteps;
      ui.frameMs = frame.frameMs;
    }
    pushTrace("ROM directory launch");
  } catch (err) {
    pushTrace(`ROM launch missed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function applyLoadedRomResult(
  result: LoadResult,
  displayName: string,
  runtime: UiState["runtime"],
): Promise<void> {
  romDisplayName = displayName;
  romHash = hashText(displayName);
  romBytes = new Uint8Array(0) as Uint8Array<ArrayBuffer>;
  lastBrowserFile = null;
  Object.assign(ui, result);
  ui.runtime = runtime;
  ui.loaded = true;
  ui.nativeStates = Boolean(result.statePath);
  ui.status = "LOADED";
  ui.lastError = "";
  document.querySelector("#rom-name")!.textContent = displayName;
  await refreshStateSlots();
  renderUi();
}

function renderRomDir(parent: string | null = null): void {
  romDirPathLabel.textContent = romDirRoot ? basename(romDirRoot) || romDirRoot : "No directory";
  romBreadcrumb.textContent = romDirPath ? `/${romDirPath}` : "/";
  if (!romDirRoot) {
    romList.innerHTML = `<button type="button" disabled>Set ROM directory</button>`;
    return;
  }
  const rows = [];
  if (parent !== null) {
    rows.push(
      `<button data-rom-kind="dir" data-rom-path="${escapeHtml(parent)}" type="button"><span>..</span><strong>Parent</strong></button>`,
    );
  }
  rows.push(
    ...romDirEntries.map((entry) => {
      const kind = entry.isDir ? "dir" : "rom";
      return `<button data-rom-kind="${kind}" data-rom-path="${escapeHtml(entry.path)}" data-rom-name="${escapeHtml(entry.name)}" type="button"><span>${entry.isDir ? "DIR" : "ROM"}</span><strong>${escapeHtml(entry.name)}</strong></button>`;
    }),
  );
  romList.innerHTML = rows.length
    ? rows.join("")
    : `<button type="button" disabled>No ROMs here</button>`;
}

function cloneDefaultBindings(): Record<InputName, ControlBinding> {
  return Object.fromEntries(
    inputNames.map((name) => [
      name,
      {
        key: defaultBindings[name].key,
        pad: { ...defaultBindings[name].pad },
      },
    ]),
  ) as Record<InputName, ControlBinding>;
}

function cloneDefaultDogsBindings(): Record<DogsBindingName, ControlBinding> {
  return Object.fromEntries(
    dogsBindingNames.map((name) => [
      name,
      {
        key: defaultDogsBindings[name].key,
        pad: { ...defaultDogsBindings[name].pad },
      },
    ]),
  ) as Record<DogsBindingName, ControlBinding>;
}

function readStoredBindings(): Record<InputName, ControlBinding> {
  const defaults = cloneDefaultBindings();
  try {
    const raw = window.localStorage.getItem(bindingsStorageKey);
    const parsed = raw ? (JSON.parse(raw) as Partial<Record<InputName, ControlBinding>>) : null;
    if (!parsed) {
      return defaults;
    }
    for (const name of inputNames) {
      const binding = parsed[name];
      if (binding?.key && binding.pad?.kind && binding.pad.code) {
        defaults[name] = {
          key: binding.key,
          pad: {
            kind: binding.pad.kind,
            code: binding.pad.code,
            direction: binding.pad.direction,
          },
        };
      }
    }
  } catch {
    return defaults;
  }
  return defaults;
}

function readStoredDogsBindings(): Record<DogsBindingName, ControlBinding> {
  const defaults = cloneDefaultDogsBindings();
  try {
    const raw = window.localStorage.getItem(dogsBindingsStorageKey);
    const parsed = raw ? (JSON.parse(raw) as Partial<Record<DogsBindingName, ControlBinding>>) : null;
    if (!parsed) {
      return defaults;
    }
    for (const name of dogsBindingNames) {
      const binding = parsed[name];
      if (binding?.key && binding.pad?.kind && binding.pad.code) {
        defaults[name] = {
          key: binding.key,
          pad: {
            kind: binding.pad.kind,
            code: binding.pad.code,
            direction: binding.pad.direction,
          },
        };
      }
    }
  } catch {
    return defaults;
  }
  return defaults;
}

function storeBindings(): void {
  window.localStorage.setItem(bindingsStorageKey, JSON.stringify(controlBindings));
}

function storeDogsBindings(): void {
  window.localStorage.setItem(dogsBindingsStorageKey, JSON.stringify(dogsControlBindings));
}

function openControls(scope: "global" | "dogs" = dogsMode ? "dogs" : "global"): void {
  controlsScope = scope;
  controlsEyebrow.textContent = scope === "dogs" ? "EutherDogs Input Matrix" : "Input Matrix";
  controlsTitle.textContent = scope === "dogs" ? "EutherDogs Controls" : "Controls";
  if (scope === "dogs") {
    hideDogsInventory();
    screenGlass.appendChild(controlsModal);
    controlsModal.classList.add("is-dogs");
  } else {
    controlsModalHome.appendChild(controlsModal);
    controlsModal.classList.remove("is-dogs");
  }
  controlsOpen = true;
  controlsModal.classList.add("is-open");
  controlsModal.setAttribute("aria-hidden", "false");
  renderBindings();
  startGamepadPolling();
}

function closeControls(): void {
  controlsOpen = false;
  captureTarget = null;
  captureMode = null;
  controlsModal.classList.remove("is-open");
  controlsModal.setAttribute("aria-hidden", "true");
  renderBindings();
}

function renderBindings(): void {
  const names: Array<InputName | DogsBindingName> = controlsScope === "dogs" ? dogsBindingNames : inputNames;
  bindingRows.innerHTML = names
    .map((name) => {
      const binding = controlsBindingForName(name);
      const isKeyCapture = captureTarget === name && captureMode === "key";
      const isPadCapture = captureTarget === name && captureMode === "pad";
      return `
        <div class="binding-row" data-binding-row="${name}">
          <strong>${controlsLabelForName(name)}</strong>
          <button data-bind="key" data-input="${name}" type="button">${isKeyCapture ? "Press key" : labelKey(binding.key)}</button>
          <button data-bind="pad" data-input="${name}" type="button">${isPadCapture ? "Press pad" : labelPad(binding.pad)}</button>
        </div>
      `;
    })
    .join("");
  captureReadout.textContent =
    captureTarget && captureMode
      ? `Listening for ${captureMode === "key" ? "keyboard" : "pad"} input: ${controlsLabelForName(captureTarget)}`
      : controlsScope === "dogs"
        ? "EutherDogs bindings"
        : "Ready";
  renderGamepadList();
}

function controlsBindingForName(name: InputName | DogsBindingName): ControlBinding {
  return controlsScope === "dogs" ? dogsControlBindings[name as DogsBindingName] : controlBindings[name as InputName];
}

function controlsLabelForName(name: InputName | DogsBindingName): string {
  return controlsScope === "dogs" ? dogsBindingLabels[name as DogsBindingName] : inputLabels[name as InputName];
}

function labelKey(key: string): string {
  if (key === " ") {
    return "Space";
  }
  return key.replace("Arrow", "");
}

function labelPad(binding: PadBinding): string {
  if (binding.kind === "axis") {
    return `${binding.code} ${binding.direction === "negative" ? "-" : "+"}`;
  }
  return binding.code;
}

function startGamepadPolling(): void {
  if (gamepadPollTimer !== null) {
    return;
  }
  void pollGamepads();
  gamepadPollTimer = window.setInterval(() => void pollGamepads(), 90);
}

async function pollGamepads(): Promise<void> {
  const snapshot = await readGamepadSnapshot();
  lastGamepadSnapshot = snapshot;
  applyGamepadSnapshot(snapshot);
  if (controlsOpen) {
    renderGamepadList();
  }
}

async function readGamepadSnapshot(): Promise<GamepadSnapshot> {
  if (isTauri && ui.runtime === "tauri") {
    try {
      return await invoke<GamepadSnapshot>("gamepad_snapshot");
    } catch (err) {
      return browserGamepadSnapshot(String(err));
    }
  }
  if (ui.runtime === "bridge") {
    try {
      return await bridgeJson<GamepadSnapshot>("/gamepads", {}, 300);
    } catch (err) {
      return browserGamepadSnapshot(String(err));
    }
  }
  return browserGamepadSnapshot(null);
}

function browserGamepadSnapshot(error: string | null): GamepadSnapshot {
  const pads = Array.from(navigator.getGamepads?.() ?? [])
    .filter((pad): pad is Gamepad => Boolean(pad))
    .map((pad) => ({
      id: String(pad.index),
      name: pad.id,
      controls: browserPadControls(pad),
    }));
  return {
    available: true,
    error,
    gamepads: pads,
  };
}

function browserPadControls(pad: Gamepad): PadControl[] {
  const buttonNames = [
    "South",
    "East",
    "West",
    "North",
    "LeftTrigger",
    "RightTrigger",
    "LeftTrigger2",
    "RightTrigger2",
    "Select",
    "Start",
    "LeftThumb",
    "RightThumb",
    "DPadUp",
    "DPadDown",
    "DPadLeft",
    "DPadRight",
    "Mode",
  ];
  const controls: PadControl[] = [];
  pad.buttons.forEach((button, index) => {
    const code = buttonNames[index] ?? `Button${index}`;
    controls.push({
      id: code,
      label: code,
      pressed: button.pressed || button.value > 0.55,
      value: button.value,
      kind: "button",
    });
  });
  const axisNames = ["LeftStickX", "LeftStickY", "RightStickX", "RightStickY"];
  pad.axes.forEach((value, index) => {
    const code = axisNames[index] ?? `Axis${index}`;
    controls.push({
      id: `${code}-negative`,
      label: `${code} -`,
      pressed: value < -0.45,
      value,
      kind: "axis",
      direction: "negative",
    });
    controls.push({
      id: `${code}-positive`,
      label: `${code} +`,
      pressed: value > 0.45,
      value,
      kind: "axis",
      direction: "positive",
    });
  });
  return controls;
}

function applyGamepadSnapshot(snapshot: GamepadSnapshot): void {
  const next = emptyInputState();
  let capturedPad = false;
  for (const pad of snapshot.gamepads) {
    for (const control of pad.controls) {
      if (!control.pressed) {
        continue;
      }
      if (captureTarget && captureMode === "pad") {
        const binding = {
          kind: control.kind,
          code: control.kind === "axis" ? control.id.replace(/-(negative|positive)$/, "") : control.id,
          direction: control.direction,
        } as PadBinding;
        if (controlsScope === "dogs") {
          dogsControlBindings[captureTarget as DogsBindingName].pad = binding;
          storeDogsBindings();
        } else {
          controlBindings[captureTarget as InputName].pad = binding;
          storeBindings();
        }
        captureTarget = null;
        captureMode = null;
        capturedPad = true;
        renderBindings();
      }
      for (const name of inputNames) {
        const binding = dogsMode ? dogsControlBindings[name].pad : controlBindings[name].pad;
        if (padMatches(control, binding)) {
          next[name] = true;
        }
      }
    }
  }
  if (dogsMode && !capturedPad) {
    applyDogsGamepadActions(snapshot);
  }
  let changed = false;
  for (const name of inputNames) {
    changed ||= gamepadState[name] !== next[name];
    gamepadState[name] = next[name];
  }
  if (changed) {
    recomputeInputState();
  }
}

function applyDogsGamepadActions(snapshot: GamepadSnapshot): void {
  const pressed = new Set<Exclude<DogsBindingName, InputName>>();
  for (const pad of snapshot.gamepads) {
    for (const control of pad.controls) {
      if (!control.pressed) {
        continue;
      }
      for (const action of Object.keys(dogsGamepadActionState) as Array<Exclude<DogsBindingName, InputName>>) {
        if (padMatches(control, dogsControlBindings[action].pad)) {
          pressed.add(action);
        }
      }
    }
  }

  const becamePressed = (action: Exclude<DogsBindingName, InputName>) => {
    const isPressed = pressed.has(action);
    const wasPressed = dogsGamepadActionState[action];
    dogsGamepadActionState[action] = isPressed;
    return isPressed && !wasPressed;
  };

  if (becamePressed("inventory")) {
    toggleDogsInventory();
  }
  const mapPressed = pressed.has("map");
  dogsGamepadActionState.map = mapPressed;
  if (dogsMapOpen !== mapPressed) {
    dogsMapOpen = mapPressed;
    if (dogsFrame) drawDogsFrame(dogsFrame);
  }
  for (let slot = 0; slot < 5; slot += 1) {
    if (becamePressed(`weapon${slot + 1}` as Exclude<DogsBindingName, InputName>)) {
      void syncDogsWeaponSlot(slot);
    }
  }
  const answer = becamePressed("answerYes")
    ? "yes"
    : becamePressed("answerNo")
      ? "no"
      : becamePressed("answerOther")
        ? "other"
        : null;
  if (answer && dogsFrame) {
    const dialogue = dogsLocalInspectionDialogue(dogsFrame);
    if (dialogue && !dialogue.complete) {
      void answerDogsInspection(answer);
    }
  }
}

function padMatches(control: PadControl, binding: PadBinding): boolean {
  if (control.kind !== binding.kind) {
    return false;
  }
  if (binding.kind === "axis") {
    const code = control.id.replace(/-(negative|positive)$/, "");
    return code === binding.code && control.direction === binding.direction;
  }
  return control.id === binding.code;
}

function renderGamepadList(): void {
  if (!lastGamepadSnapshot.available) {
    gamepadList.innerHTML = `<span>Gilrs unavailable</span>`;
    return;
  }
  if (lastGamepadSnapshot.gamepads.length === 0) {
    gamepadList.innerHTML = `<span>${lastGamepadSnapshot.error ? "Browser fallback" : "No pad detected"}</span>`;
    return;
  }
  gamepadList.innerHTML = lastGamepadSnapshot.gamepads
    .map((pad) => {
      const active = pad.controls.filter((control) => control.pressed).slice(0, 6);
      return `
        <div class="gamepad-device">
          <strong>${escapeHtml(pad.name)}</strong>
          <span>${active.length ? active.map((control) => escapeHtml(control.label)).join(", ") : "Idle"}</span>
        </div>
      `;
    })
    .join("");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function playHomeMarkup(): string {
  return `
    <section class="rail-section play-home-panel" id="play-home-panel">
      <div class="section-head">
        <div>
          <p class="section-label">Reaction Lobby</p>
          <strong>Dock</strong>
        </div>
        <span id="play-mode-status">Ready</span>
      </div>
      <div class="lobby-dock-actions">
        <button data-reaction-home-action="refresh" type="button">Scan rooms</button>
        <button data-reaction-home-action="video-chat" type="button">Video Chat</button>
        <button data-reaction-home-action="eutherium" type="button">Eutherium</button>
        <button data-reaction-home-action="chat-focus" type="button">Reaction Chat</button>
      </div>
    </section>
  `;
}

function reactionLobbyHomeMarkup(): string {
  return `
    <section class="reaction-lobby-home" id="reaction-lobby-home" hidden>
      <div class="reaction-lobby-hero">
        <div>
          <p class="eyebrow">Reaction Lobby</p>
          <h2>Control Room</h2>
        </div>
        <div class="reaction-lobby-summary" id="reaction-lobby-summary">Scanning</div>
      </div>
      <section class="reaction-lobby-panel eutherium-lobby-panel">
        <div class="section-head">
          <div>
            <p class="section-label">Eutherium</p>
            <strong>Rewards, shop, trophy room</strong>
          </div>
          <span id="eutherium-lobby-status">Not loaded</span>
        </div>
        <div class="eutherium-lobby-grid">
          <div class="eutherium-lobby-balance">
            <span>Your balance</span>
            <strong id="eutherium-lobby-balance">-- EUX</strong>
          </div>
          <div class="eutherium-lobby-actions">
            <button data-workspace-window="eutherium" type="button">Shop</button>
            <button data-workspace-window="eutherium" type="button">Trophy Room</button>
            <button data-reaction-home-action="eutherium-refresh" type="button">Sync</button>
          </div>
        </div>
        <div class="eutherium-lobby-award" id="eutherium-lobby-award"></div>
        <div class="eutherium-lobby-feed" id="eutherium-lobby-feed">
          <span>No recent awards</span>
        </div>
      </section>
      <section class="reaction-lobby-panel reaction-lobby-play-panel">
        <div class="section-head">
          <div>
            <p class="section-label">Play Vessels</p>
            <strong>Choose chamber</strong>
          </div>
          <span>${playModeCards.length} modes</span>
        </div>
        <div class="reaction-mode-grid" aria-label="choose play mode">
          ${playModeCards.map((card) => reactionModeCard(card)).join("")}
        </div>
        <div class="reaction-lobby-start-grid">
          <button data-reaction-home-action="start-megadrive" type="button">Start MegaDrive vessel</button>
          <button data-reaction-home-action="start-eutheralert" type="button">Start EutherAlert vessel</button>
          <button data-reaction-home-action="start-eutherdoom" type="button">Start EutherDoom vessel</button>
          <button data-reaction-home-action="open-euthercivet" type="button">Open EutherCivet vessel</button>
          <button data-reaction-home-action="open-eutherduke" type="button">Open EutherDuke vessel</button>
        </div>
      </section>
      <section class="reaction-lobby-panel reaction-lobby-social-panel">
        <div class="section-head">
          <div>
            <p class="section-label">Social Tools</p>
            <strong>Chat, video, lists</strong>
          </div>
          <span>${visibleInteractionFriends().filter((friend) => friend.status === "Online").length} online</span>
        </div>
        <div class="reaction-social-grid">
          ${reactionSocialToolCard("Video Chat", videoChatStatusMessage, "Camera, watch, mute", "video-chat")}
          ${reactionSocialToolCard("Reaction Chat", "Live room chat", "Room feed", "chat-focus")}
          ${reactionSocialToolCard("Audiobooks", eutherBooksStatus, "Ebooks as spoken audio", undefined, "books")}
          ${reactionSocialToolCard("Shopping List", "Shared markdown", "Synced Markdown", undefined, "shopping")}
          ${reactionSocialToolCard("Eutherium", "Ledger, shop, trophies", "Family rewards", undefined, "eutherium")}
          ${reactionSocialToolCard("Friends", "Online users", "Host users", undefined, "friends")}
          ${reactionSocialToolCard("Shared Spaces", `${interactionSpaces.length} spaces`, "Docs and rooms", undefined, "spaces")}
          ${reactionSocialToolCard("Social Desk", `${visibleInteractionFriends().filter((friend) => friend.status === "Online").length} online`, "Invites and modules", undefined, "interaction")}
        </div>
      </section>
      <section class="reaction-lobby-vessels-panel">
        <div class="section-head">
          <p class="section-label">Active Reaction Vessels</p>
          <button data-reaction-home-action="refresh" class="mini-action" type="button">Scan</button>
        </div>
        <div class="reaction-lobby-vessels" id="reaction-lobby-vessels"></div>
      </section>
    </section>
  `;
}

function reactionSocialToolCard(
  label: string,
  kicker: string,
  detail: string,
  action?: string,
  workspaceWindow?: WorkspaceWindow,
): string {
  const actionAttr = action ? ` data-reaction-home-action="${escapeHtml(action)}"` : "";
  const windowAttr = workspaceWindow ? ` data-workspace-window="${workspaceWindow}"` : "";
  const statusKey = action ?? workspaceWindow ?? label;
  return `
    <button class="reaction-tool-card"${actionAttr}${windowAttr} type="button">
      <span data-reaction-tool-status="${escapeHtml(statusKey)}">${escapeHtml(kicker)}</span>
      <strong>${escapeHtml(label)}</strong>
      <small>${escapeHtml(detail)}</small>
    </button>
  `;
}

function reactionModeCard(card: (typeof playModeCards)[number]): string {
  return `
    <button class="reaction-mode-card reaction-mode-${card.mode}" data-play-mode="${card.mode}" type="button">
      <span>${escapeHtml(card.kicker)}</span>
      <strong>${escapeHtml(card.label)}</strong>
      <small>${escapeHtml(card.detail)}</small>
      <em>${escapeHtml(card.action)}</em>
    </button>
  `;
}

function interactionLobbyPageMarkup(): string {
  return `
    <section class="interaction-hero">
      <div class="interaction-identity">
        <p class="eyebrow">Interaction Lobby</p>
        <h2>Friends, spaces, lists, notes</h2>
        <div class="interaction-current-user">
          <span class="user-presence-dot"></span>
          <strong id="interaction-current-user-name">Current user: Nichlas</strong>
          <em id="interaction-current-user-status">Online</em>
        </div>
      </div>
      <div class="interaction-hero-actions">
        <button data-app-route="play" type="button">Reaction Lobby</button>
        <button class="primary-action" data-workspace-window="shopping" type="button">Open shopping list</button>
      </div>
    </section>
    <section class="interaction-grid">
      <div class="interaction-panel interaction-quick-actions">
        <div class="section-head">
          <p class="section-label">Quick Actions</p>
          <span>Ready for wiring</span>
        </div>
        <div class="quick-action-grid">
          ${quickActionCard("Add friend", "Send a request into the friend mesh", "friends")}
          ${quickActionCard("Create shared space", "Start a room for people and files", "spaces")}
          ${quickActionCard("Create shopping list", "Make a shared Markdown checklist", "shopping")}
          ${quickActionCard("Open audiobooks", "Listen to local EutherBooks", "books")}
          ${quickActionCard("Open Eutherium", "Shop, inventory and trophy room", "eutherium")}
          ${quickActionCard("Start chat", "Open a direct line", "interaction")}
        </div>
      </div>
      ${friendPreviewList()}
      ${sharedSpacePreviewList()}
      ${invitePreviewList()}
      <div class="interaction-panel interaction-future-panel">
        <div class="section-head">
          <p class="section-label">Future Modules</p>
          <span>Foundation slots</span>
        </div>
        <div class="future-module-grid">
          ${interactionFutureModules.map((module) => futureModuleCard(module)).join("")}
        </div>
      </div>
    </section>
  `;
}

function shoppingListPanelMarkup(): string {
  return `
    <div class="interaction-panel interaction-shopping-panel" id="interaction-shopping-panel" hidden>
      <div class="section-head">
        <div>
          <p class="section-label">Shared Shopping List</p>
          <strong id="shopping-list-title">shopping-list.md</strong>
        </div>
        <span id="shopping-list-status">Not loaded</span>
      </div>
      <div class="shopping-link-meta">
        <span>Linked document</span>
        <strong id="shopping-list-shared-id">hemmet</strong>
      </div>
      <div class="shopping-share-panel">
        <div class="shopping-share-head">
          <span>Shared with</span>
          <strong id="shopping-share-status">Not shared</strong>
        </div>
        <div id="shopping-share-compact" class="shopping-share-compact">Only you</div>
        <details class="shopping-share-details">
          <summary>Manage sharing</summary>
          <div id="shopping-list-members" class="shopping-list-members"></div>
          <form id="shopping-share-form" class="shopping-share-form">
            <select id="shopping-share-user" aria-label="share shopping list with user"></select>
            <select id="shopping-share-role" aria-label="shopping list share role">
              <option value="edit">Can edit</option>
              <option value="view">View only</option>
            </select>
            <button type="submit">Share</button>
          </form>
        </details>
      </div>
      <div id="shopping-list-items" class="shopping-list-items"></div>
      <form id="shopping-list-add-form" class="shopping-list-add-form">
        <input id="shopping-list-add-input" type="text" placeholder="Add item" aria-label="shopping list item" autocomplete="off" />
        <select id="shopping-list-category" aria-label="shopping list category">
          <option value="auto">Auto category</option>
          ${shoppingCategoryOrder.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("")}
        </select>
        <button type="submit">Add</button>
      </form>
      <details class="shopping-markdown-editor">
        <summary>Markdown source</summary>
        <textarea id="shopping-list-markdown" spellcheck="false" aria-label="shopping list markdown"></textarea>
      </details>
      <div class="shopping-list-actions">
        <button id="shopping-list-sort" type="button">Smart sort</button>
        <button id="shopping-list-save" class="primary-action" type="button">Save .md</button>
      </div>
    </div>
  `;
}

function quickActionCard(title: string, detail: string, workspaceWindow?: WorkspaceWindow): string {
  const windowAttr = workspaceWindow ? ` data-workspace-window="${workspaceWindow}"` : "";
  return `
    <button class="quick-action-card"${windowAttr} type="button">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(detail)}</span>
    </button>
  `;
}

function friendPreviewList(): string {
  const friends = visibleInteractionFriends();
  return `
    <div class="interaction-panel friend-preview-list" id="friend-preview-list">
      <div class="section-head">
        <p class="section-label">Friends</p>
        <span id="friend-preview-count">${friends.filter((friend) => friend.status === "Online").length} online</span>
      </div>
      <div id="friend-preview-rows" class="interaction-list-rows">
        ${friendRowsMarkup(friends)}
      </div>
    </div>
  `;
}

function visibleInteractionFriends(): InteractionFriend[] {
  const source = interactionUsers.length > 0 ? interactionUsers : fallbackInteractionFriends;
  const currentUser = hostUsername?.toLowerCase();
  const filtered = currentUser
    ? source.filter((friend) => friend.name.toLowerCase() !== currentUser)
    : source;
  return filtered.length > 0 ? filtered : source;
}

function friendRowsMarkup(friends: InteractionFriend[]): string {
  if (friends.length === 0) {
    return `<span class="interaction-empty">No users loaded</span>`;
  }
  return friends
    .map(
      (friend) => `
        <div class="interaction-row">
          <span class="presence ${friend.status === "Online" ? "is-online" : ""}"></span>
          <div>
            <strong>${escapeHtml(friend.name)}</strong>
            <small>${escapeHtml(friend.location)}</small>
          </div>
          <em>${friend.status}</em>
        </div>
      `,
    )
    .join("");
}

function sharedSpacePreviewList(): string {
  return `
    <div class="interaction-panel shared-space-preview-list">
      <div class="section-head">
        <p class="section-label">Shared Spaces</p>
        <span>${interactionSpaces.length} spaces</span>
      </div>
      ${interactionSpaces
        .map(
          (space) => `
            <button class="interaction-space-row" type="button">
              <strong>${escapeHtml(space.name)}</strong>
              <span>${escapeHtml(space.detail)}</span>
            </button>
          `,
        )
        .join("")}
    </div>
  `;
}

function invitePreviewList(): string {
  return `
    <div class="interaction-panel invite-preview-list">
      <div class="section-head">
        <p class="section-label">Invites</p>
        <span>${interactionInvites.length} pending</span>
      </div>
      ${interactionInvites
        .map(
          (invite) => `
            <div class="invite-row">
              <strong>${escapeHtml(invite.kind)}</strong>
              <span>${escapeHtml(invite.text)}</span>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function futureModuleCard(module: FutureModule): string {
  return `
    <div class="future-module-card">
      <strong>${escapeHtml(module.name)}</strong>
      <span>${escapeHtml(module.detail)}</span>
    </div>
  `;
}

function initializeShaderControls(): void {
  shaderSelect.innerHTML = shaderConfig.available
    .map((name) => `<option value="${name}">${shaderDisplayName(name)}</option>`)
    .join("");
  shaderSelect.value = selectedShader;
  renderShaderControls();
}

function setActiveShader(name: string): void {
  selectedShader = shaderConfig.presets[name] ? name : shaderConfig.selected;
  shaderConfig.selected = selectedShader;
  activeShaderParams = cloneShaderParams(shaderConfig.presets[selectedShader]);
  window.localStorage.setItem(shaderStorageKey, selectedShader);
  renderShaderControls();
  renderShaderFrame();
  scheduleShaderConfigSave();
}

function renderShaderControls(): void {
  shaderSelect.value = selectedShader;
  shaderMode.textContent = shaderDisplayName(selectedShader);
  shaderControls.innerHTML = shaderParamNames
    .map((param) => {
      const value = activeShaderParams[param];
      const max = param === "contrast_curve" || param === "saturation" || param === "luma_sharpness"
        ? "1.60"
        : "1.00";
      const min = param === "contrast_curve" || param === "saturation" || param === "luma_sharpness"
        ? "0.40"
        : "0.00";
      return `
        <label class="shader-control">
          <span>${shaderParamLabels[param]}</span>
          <input data-shader-param="${param}" type="range" min="${min}" max="${max}" step="0.01" value="${value.toFixed(2)}" />
          <strong data-shader-value="${param}">${value.toFixed(2)}</strong>
        </label>
      `;
    })
    .join("");
}

function renderShaderFrame(): void {
  if (!shaderRenderer) {
    shaderCanvas.classList.add("is-disabled");
    return;
  }
  shaderCanvas.width = videoCanvas.width;
  shaderCanvas.height = videoCanvas.height;
  shaderRenderer.render(videoCanvas, activeShaderParams, performance.now() / 1000);
}

function readStoredShader(config: ShaderConfig): string {
  const stored = window.localStorage.getItem(shaderStorageKey);
  if (stored && config.presets[stored]) {
    return stored;
  }
  return config.presets[config.selected] ? config.selected : "raw_pixels";
}

function readStoredShaderConfigSource(): string {
  return window.localStorage.getItem(shaderConfigStorageKey) ?? shaderToml;
}

async function loadShaderConfigFile(): Promise<void> {
  if (shaderConfigLoadAttempted) {
    return;
  }
  if (!isTauri && ui.runtime !== "bridge") {
    return;
  }
  shaderConfigLoadAttempted = true;
  const toml = await readShaderConfigToml();
  if (!toml) {
    return;
  }
  applyShaderConfigToml(toml);
}

async function readShaderConfigToml(): Promise<string | null> {
  if (isTauri) {
    try {
      return await invoke<string | null>("read_shader_config_toml");
    } catch {
      return null;
    }
  }
  if (ui.runtime === "bridge") {
    try {
      const response = await bridgeRequest("/shader-config", {}, 300);
      if (response.status === 204) {
        return null;
      }
      return await response.text();
    } catch {
      return null;
    }
  }
  return null;
}

function applyShaderConfigToml(toml: string): void {
  const next = parseShaderConfig(toml);
  shaderConfig = next;
  selectedShader = next.presets[next.selected] ? next.selected : readStoredShader(next);
  activeShaderParams = cloneShaderParams(next.presets[selectedShader]);
  window.localStorage.setItem(shaderConfigStorageKey, serializeShaderConfig(next));
  window.localStorage.setItem(shaderStorageKey, selectedShader);
  initializeShaderControls();
  renderShaderFrame();
}

function scheduleShaderConfigSave(): void {
  const toml = serializeShaderConfig(shaderConfig);
  window.localStorage.setItem(shaderConfigStorageKey, toml);
  window.localStorage.setItem(shaderStorageKey, selectedShader);
  if (shaderSaveTimer !== null) {
    window.clearTimeout(shaderSaveTimer);
  }
  shaderSaveTimer = window.setTimeout(() => {
    shaderSaveTimer = null;
    void saveShaderConfigToml(toml);
  }, 250);
}

async function saveShaderConfigToml(toml: string): Promise<void> {
  if (isTauri) {
    try {
      await invoke("save_shader_config_toml", { toml });
    } catch {
      pushTrace("Shader TOML save missed");
    }
    return;
  }
  if (ui.runtime === "bridge") {
    try {
      await bridgeRequest("/shader-config", {
        method: "POST",
        headers: { "Content-Type": "text/plain; charset=utf-8" },
        body: toml,
      });
    } catch {
      pushTrace("Shader TOML save missed");
    }
  }
}

function serializeShaderConfig(config: ShaderConfig): string {
  const lines = [
    "[video]",
    `shader = "${config.selected}"`,
    "",
    "[video.shader_presets]",
    `available = [${config.available.map((name) => `"${name}"`).join(", ")}]`,
    "",
  ];
  for (const name of config.available) {
    const preset = config.presets[name];
    if (!preset) {
      continue;
    }
    lines.push(`[shader.${name}]`);
    for (const param of shaderParamNames) {
      lines.push(`${param} = ${preset[param].toFixed(2)}`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function cloneShaderParams(params: ShaderParams): ShaderParams {
  return { ...params };
}

function defaultShaderParams(): ShaderParams {
  return {
    scanlines: 0,
    phosphor_glow: 0,
    rgb_mask: 0,
    vignette: 0,
    curvature: 0,
    noise: 0,
    chroma_bleed: 0,
    luma_sharpness: 1,
    dither_blend: 0,
    dot_crawl: 0,
    rf_noise: 0,
    bloom: 0,
    highlight_glow: 0,
    contrast_curve: 1,
    saturation: 1,
    glass_shimmer: 0,
  };
}

function parseShaderConfig(source: string): ShaderConfig {
  const presets: Record<string, ShaderParams> = {};
  let selected = "system_regis_crt";
  let available: string[] = ["raw_pixels", "system_regis_crt"];
  let section = "";
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const sectionMatch = line.match(/^\[(.+)]$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      if (section.startsWith("shader.")) {
        presets[section.slice("shader.".length)] = defaultShaderParams();
      }
      continue;
    }
    const [rawKey, ...rawValueParts] = line.split("=");
    if (!rawKey || rawValueParts.length === 0) {
      continue;
    }
    const key = rawKey.trim();
    const value = rawValueParts.join("=").trim().replace(/,$/, "");
    if (section === "video" && key === "shader") {
      selected = value.replaceAll('"', "");
      continue;
    }
    if (section === "video.shader_presets" && key === "available") {
      available = parseTomlArray(value);
      continue;
    }
    if (section.startsWith("shader.")) {
      const preset = section.slice("shader.".length);
      if (shaderParamNames.includes(key as ShaderParamName)) {
        presets[preset][key as ShaderParamName] = Number(value);
      }
    }
  }
  if (!presets.raw_pixels) {
    presets.raw_pixels = defaultShaderParams();
  }
  available = available.filter((name) => Boolean(presets[name]));
  if (!available.includes("raw_pixels")) {
    available.unshift("raw_pixels");
  }
  return { selected, available, presets };
}

function parseTomlArray(value: string): string[] {
  return value
    .replace(/^\[/, "")
    .replace(/]$/, "")
    .split(",")
    .map((item) => item.trim().replaceAll('"', ""))
    .filter(Boolean);
}

function shaderDisplayName(name: string): string {
  return name
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

class ShaderRenderer {
  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly gl: WebGLRenderingContext,
    private readonly program: WebGLProgram,
    private readonly texture: WebGLTexture,
    private readonly uniforms: Record<string, WebGLUniformLocation>,
  ) {}

  static create(canvas: HTMLCanvasElement): ShaderRenderer | null {
    const gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) {
      return null;
    }
    const vertex = compileShader(gl, gl.VERTEX_SHADER, SHADER_VERTEX);
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, SHADER_FRAGMENT);
    const program = gl.createProgram();
    const texture = gl.createTexture();
    const buffer = gl.createBuffer();
    if (!vertex || !fragment || !program || !texture || !buffer) {
      return null;
    }
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn(gl.getProgramInfoLog(program));
      return null;
    }
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 0, 0, 1, -1, 1, 0, -1, 1, 0, 1, 1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const position = gl.getAttribLocation(program, "aPosition");
    const uv = gl.getAttribLocation(program, "aUv");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(uv);
    gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 16, 8);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const uniformNames = [
      "uFrame",
      "uSourceSize",
      "uTime",
      ...shaderParamNames.map((param) => `u_${param}`),
    ];
    const uniforms = Object.fromEntries(
      uniformNames.map((name) => [name, gl.getUniformLocation(program, name)]),
    ) as Record<string, WebGLUniformLocation | null>;
    if (Object.values(uniforms).some((uniform) => !uniform)) {
      return null;
    }
    gl.uniform1i(uniforms.uFrame, 0);
    return new ShaderRenderer(
      canvas,
      gl,
      program,
      texture,
      uniforms as Record<string, WebGLUniformLocation>,
    );
  }

  render(source: HTMLCanvasElement, params: ShaderParams, time: number): void {
    const gl = this.gl;
    if (this.canvas.width !== source.width || this.canvas.height !== source.height) {
      this.canvas.width = source.width;
      this.canvas.height = source.height;
    }
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.uniform2f(this.uniforms.uSourceSize, source.width, source.height);
    gl.uniform1f(this.uniforms.uTime, time);
    for (const param of shaderParamNames) {
      gl.uniform1f(this.uniforms[`u_${param}`], params[param]);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) {
    return null;
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn(gl.getShaderInfoLog(shader));
    return null;
  }
  return shader;
}

const SHADER_VERTEX = `
attribute vec2 aPosition;
attribute vec2 aUv;
varying vec2 vUv;

void main() {
  vUv = aUv;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const SHADER_FRAGMENT = `
precision mediump float;

uniform sampler2D uFrame;
uniform vec2 uSourceSize;
uniform float uTime;
uniform float u_scanlines;
uniform float u_phosphor_glow;
uniform float u_rgb_mask;
uniform float u_vignette;
uniform float u_curvature;
uniform float u_noise;
uniform float u_chroma_bleed;
uniform float u_luma_sharpness;
uniform float u_dither_blend;
uniform float u_dot_crawl;
uniform float u_rf_noise;
uniform float u_bloom;
uniform float u_highlight_glow;
uniform float u_contrast_curve;
uniform float u_saturation;
uniform float u_glass_shimmer;
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

vec3 saturateColor(vec3 color, float saturation) {
  float luma = dot(color, vec3(0.299, 0.587, 0.114));
  return mix(vec3(luma), color, saturation);
}

vec3 sampleFrame(vec2 uv) {
  return texture2D(uFrame, clamp(uv, vec2(0.0), vec2(1.0))).rgb;
}

void main() {
  vec2 uv = vUv;
  vec2 centered = uv * 2.0 - 1.0;
  float curve = dot(centered, centered) * u_curvature * 0.075;
  uv = uv + centered * curve;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  vec2 texel = 1.0 / uSourceSize;
  vec2 bleed = vec2(texel.x * 2.5 * u_chroma_bleed, 0.0);
  vec3 color = sampleFrame(uv);
  color.r = mix(color.r, sampleFrame(uv + bleed).r, u_chroma_bleed);
  color.b = mix(color.b, sampleFrame(uv - bleed).b, u_chroma_bleed);

  vec3 blur = (
    sampleFrame(uv + vec2(texel.x, 0.0)) +
    sampleFrame(uv - vec2(texel.x, 0.0)) +
    sampleFrame(uv + vec2(0.0, texel.y)) +
    sampleFrame(uv - vec2(0.0, texel.y))
  ) * 0.25;
  float soften = clamp(1.0 - u_luma_sharpness, 0.0, 1.0);
  float sharpen = clamp(u_luma_sharpness - 1.0, 0.0, 0.8);
  color = mix(color, blur, soften);
  color += (color - blur) * sharpen;

  float checker = mod(floor(uv.x * uSourceSize.x) + floor(uv.y * uSourceSize.y), 2.0);
  color = mix(color, mix(color, blur, 0.7), u_dither_blend * checker);

  float scan = 0.5 + 0.5 * sin(uv.y * uSourceSize.y * 3.14159265);
  color *= 1.0 - u_scanlines * (1.0 - scan);

  float maskIndex = mod(floor(uv.x * uSourceSize.x * 3.0), 3.0);
  vec3 mask = vec3(
    maskIndex < 1.0 ? 1.0 : 1.0 - u_rgb_mask,
    maskIndex >= 1.0 && maskIndex < 2.0 ? 1.0 : 1.0 - u_rgb_mask,
    maskIndex >= 2.0 ? 1.0 : 1.0 - u_rgb_mask
  );
  color *= mask;

  float bright = max(max(color.r, color.g), color.b);
  vec3 glow = blur * (u_phosphor_glow + u_bloom * smoothstep(0.55, 1.0, bright));
  color += glow;

  vec3 highlight = color * color * vec3(0.75, 0.95, 1.25);
  color += highlight * u_highlight_glow * smoothstep(0.58, 0.95, bright);

  float crawl = sin((uv.x * uSourceSize.x + uv.y * 2.0 + uTime * 55.0) * 3.14159265);
  color += crawl * u_dot_crawl * 0.035;

  float grain = hash(floor(uv * uSourceSize) + uTime * 60.0) - 0.5;
  color += grain * (u_noise + u_rf_noise) * 0.12;

  color = saturateColor(color, u_saturation);
  color = pow(max(color, vec3(0.0)), vec3(1.0 / max(u_contrast_curve, 0.01)));

  float vig = smoothstep(1.22, 0.18, length(centered));
  color *= mix(1.0, vig, u_vignette);

  float shimmer = sin((uv.y * 90.0) + uTime * 1.7) * u_glass_shimmer * 0.035;
  color += shimmer;

  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

async function chooseDesktopRom(): Promise<void> {
  const selected = await open({
    multiple: false,
    filters: [
      {
        name: "Mega Drive ROM",
        extensions: ["bin", "gen", "md", "smd", "rom"],
      },
    ],
  });
  if (typeof selected === "string") {
    await loadRomPath(selected);
  }
}

function updateStartupModePreference(mode: "dogs" | "megadrive"): void {
  if (!hostedServerMode) {
    return;
  }
  const url = new URL(window.location.href);
  if (mode === "dogs") {
    url.searchParams.set("eutherdogs", "1");
    url.searchParams.delete("megadrive");
    megaDrivePanel.open = false;
  } else {
    url.searchParams.set("megadrive", "1");
    url.searchParams.delete("eutherdogs");
    megaDrivePanel.open = true;
  }
  window.history.replaceState({}, "", url);
}

async function loadRomPath(path: string): Promise<void> {
  if (civetMode) {
    leaveCivetMode();
  }
  if (dogsMode) {
    leaveDogsMode();
  }
  updateStartupModePreference("megadrive");
  ui.playing = false;
  playToggle.textContent = "Play";
  stopBridgeStream();
  await invoke("set_native_running", { running: false });
  romDisplayName = basename(path);
  romHash = hashText(path);
  const result = await invoke<LoadResult>("load_rom_path", { path });
  Object.assign(ui, result);
  ui.runtime = "tauri";
  ui.loaded = true;
  ui.nativeStates = Boolean(result.statePath);
  ui.status = "LOADED";
  ui.lastError = "";
  document.querySelector("#rom-name")!.textContent = romDisplayName;
  await refreshStateSlots();
  drawSyntheticFrame();
  pushTrace(".argon path bonded");
  renderUi();
}

async function loadFile(file: File): Promise<void> {
  if (civetMode) {
    leaveCivetMode();
  }
  if (dogsMode) {
    leaveDogsMode();
  }
  updateStartupModePreference("megadrive");
  ui.playing = false;
  playToggle.textContent = "Play";
  stopBridgeStream();
  if (isTauri) {
    await invoke("set_native_running", { running: false });
  }
  lastBrowserFile = file;
  const buffer = await file.arrayBuffer();
  romBytes = new Uint8Array(buffer);
  romDisplayName = file.name;
  romHash = hashBytes(romBytes);
  const webInfo = parseWebHeader(romBytes, file.name);
  await persistCachedRom(file.name, romBytes);

  if (isTauri) {
    try {
      const result = await invoke<LoadResult>("load_rom_bytes", {
        bytes: Array.from(romBytes),
      });
      Object.assign(ui, result);
      ui.runtime = "tauri";
      ui.loaded = true;
      ui.nativeStates = Boolean(result.statePath);
      ui.status = "LOADED";
      ui.lastError = "";
      await refreshStateSlots();
      pushTrace("Native core bonded");
    } catch (error) {
      Object.assign(ui, webInfo);
      ui.runtime = "web";
      ui.loaded = true;
      ui.nativeStates = false;
      ui.status = "WEB FALLBACK";
      ui.lastError = String(error);
      loadWebSlots();
      pushTrace("Web bridge took over");
    }
  } else {
    if (await loadBytesThroughBridge(file.name, romBytes)) {
      return;
    }
    Object.assign(ui, webInfo);
    ui.runtime = "web";
    ui.loaded = true;
    ui.nativeStates = false;
    ui.status = "WEB PREVIEW";
    ui.lastError = "";
    loadWebSlots();
    pushTrace("Browser substrate loaded");
    scheduleBridgeRetry();
  }

  document.querySelector("#rom-name")!.textContent = file.name;
  drawSyntheticFrame();
  renderUi();
}

async function loadBytesThroughBridge(fileName: string, bytes: Uint8Array): Promise<boolean> {
  stopBridgeStream();
  try {
    const result = await bridgeJson<BridgeStatusResult>(
      "/load",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Rom-Name": encodeURIComponent(fileName),
        },
        body: copyArrayBuffer(bytes),
      },
      5000,
    );
    stopBridgeRetry();
    Object.assign(ui, result);
    ui.runtime = "bridge";
    ui.loaded = result.loaded ?? true;
    ui.nativeStates = Boolean(result.statePath);
    ui.status = "BRIDGE LOADED";
    ui.lastError = "";
    document.querySelector("#rom-name")!.textContent = fileName;
    await refreshBuildStatus(false);
    await refreshStateSlots();
    const frame = await bridgeFrame(5000);
    drawNativeFrame(frame);
    ui.frame = frame.frame;
    ui.cpuCycles = frame.cpuCycles;
    ui.cpuSteps = frame.cpuSteps;
    ui.frameMs = frame.frameMs;
    ui.status = frame.stopped ? "STOPPED" : "BRIDGE RUN";
    ui.lastError = frame.lastError ?? "";
    pushTrace("Browser ROM bonded to Rust core");
    renderUi();
    return true;
  } catch {
    scheduleBridgeRetry();
    return false;
  }
}

async function connectBridge(announce = true): Promise<boolean> {
  if (isTauri) {
    return false;
  }
  try {
    const result = await bridgeJson<BridgeStatusResult>("/status", {}, 700);
    stopBridgeRetry();
    Object.assign(ui, result);
    ui.runtime = "bridge";
    ui.loaded = result.loaded ?? true;
    ui.nativeStates = ui.loaded && Boolean(result.statePath);
    ui.frame = result.frame;
    ui.status = ui.loaded ? "BRIDGE READY" : "BRIDGE IDLE";
    ui.lastError = "";
    await refreshAuthStatus();
    await refreshBuildStatus(false);
    await loadShaderConfigFile();
    await loadRomDirSetting();
    document.querySelector("#rom-name")!.textContent = ui.loaded
      ? result.title
      : "Load Mega Drive";
    if (!ui.loaded) {
      ui.stateSlots = emptySlots();
      if (announce) {
        pushTrace("Rust core bridge waiting");
      }
      renderUi();
      return true;
    }
    await refreshStateSlots();
    if (lobbyRole === "spectator") {
      if (announce) {
        pushTrace("Headless core bridge online");
      }
      renderUi();
      return true;
    }
    const frame = await bridgeFrame();
    drawNativeFrame(frame);
    ui.frame = frame.frame;
    ui.cpuCycles = frame.cpuCycles;
    ui.cpuSteps = frame.cpuSteps;
    ui.frameMs = frame.frameMs;
    ui.lastError = frame.lastError ?? "";
    if (announce) {
      pushTrace("Headless core bridge online");
    }
    renderUi();
    return true;
  } catch {
    if (announce) {
      scheduleBridgeRetry();
    }
    renderUi();
    return false;
  }
}

async function buildReleaseBinary(): Promise<void> {
  if (isTauri || ui.runtime !== "bridge") {
    if (!(await connectBridge(false))) {
      pushTrace("Bridge offline");
      return;
    }
  }
  desiredBuildProfile = "release";
  const wasPlaying = pauseBridgeForRestart();
  try {
    applyBuildStatus(
      await bridgeJson<BridgeBuildStatus>("/build/release", { method: "POST" }, 1000),
    );
    pushTrace("Release build started");
    renderUi();
    pollBuildStatus();
  } catch (error) {
    ui.lastError = String(error);
    pushTrace("Release build refused");
    renderUi();
  } finally {
    bridgeRestarting = false;
    restoreBridgePlaybackAfterRestart(wasPlaying);
  }
}

async function setBridgeBuildProfile(profile: "debug" | "release"): Promise<void> {
  desiredBuildProfile = profile;
  if (isTauri || ui.runtime !== "bridge") {
    if (!(await connectBridge(false))) {
      pushTrace("Bridge offline");
      return;
    }
  }
  await refreshBuildStatus(false);
  if (profile === "release" && !ui.build.releaseReady) {
    pushTrace("Build latest bin first");
    renderUi();
    return;
  }
  const wasPlaying = pauseBridgeForRestart();
  try {
    const status = await bridgeJson<BridgeBuildStatus>(
      `/build/profile?profile=${profile}`,
      { method: "POST" },
      1000,
    );
    applyBuildStatus(status);
    pushTrace(profile === "release" ? "Release bin arming" : "Debug bridge arming");
    renderUi();
    await reconnectAfterBridgeRestart(wasPlaying);
  } catch (error) {
    ui.lastError = String(error);
    pushTrace("Bridge profile switch failed");
    renderUi();
  } finally {
    bridgeRestarting = false;
  }
}

async function refreshBuildStatus(announce = false): Promise<void> {
  if (isTauri) {
    return;
  }
  try {
    applyBuildStatus(await bridgeJson<BridgeBuildStatus>("/build/status", {}, 700));
    if (announce && ui.build.armed) {
      pushTrace("Release bin armed");
    }
  } catch {
    ui.build = {
      ...ui.build,
      building: false,
      armed: false,
      lastStatus: "offline",
      lastMessage: "Bridge offline",
    };
  } finally {
    renderUi();
  }
}

function pollBuildStatus(): void {
  if (buildPollTimer !== null) {
    window.clearInterval(buildPollTimer);
  }
  buildPollTimer = window.setInterval(async () => {
    await refreshBuildStatus(false);
    if (!ui.build.building) {
      if (buildPollTimer !== null) {
        window.clearInterval(buildPollTimer);
        buildPollTimer = null;
      }
      if (ui.build.releaseReady && desiredBuildProfile === "release") {
        await setBridgeBuildProfile("release");
      }
    }
  }, 1000);
}

function applyBuildStatus(status: BridgeBuildStatus): void {
  ui.build = status;
  desiredBuildProfile =
    status.requestedProfile === "release" || status.activeProfile === "release"
      ? "release"
      : desiredBuildProfile;
}

async function reconnectAfterBridgeRestart(resumePlayback = false): Promise<void> {
  const token = ++bridgeReconnectToken;
  ui.status = "REARMING";
  renderUi();
  await sleep(700);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (token !== bridgeReconnectToken) {
      return;
    }
    if (romBytes.length > 0) {
      if (await loadBytesThroughBridge(romDisplayName, romBytes)) {
        await refreshBuildStatus(true);
        restoreBridgePlaybackAfterRestart(resumePlayback);
        return;
      }
    } else if (await connectBridge(false)) {
      await refreshBuildStatus(true);
      restoreBridgePlaybackAfterRestart(resumePlayback);
      return;
    }
    await sleep(350);
  }
  scheduleBridgeRetry();
}

function pauseBridgeForRestart(): boolean {
  const wasPlaying = ui.playing;
  bridgeRestarting = true;
  bridgeReconnectToken += 1;
  ui.playing = false;
  playToggle.textContent = "Play";
  stopBridgeStream();
  return wasPlaying;
}

function restoreBridgePlaybackAfterRestart(wasPlaying: boolean): void {
  if (!wasPlaying || ui.runtime !== "bridge" || !ui.loaded) {
    renderUi();
    return;
  }
  ui.playing = true;
  ui.status = "RUNNING";
  playToggle.textContent = "Pause";
  resetScheduledAudio();
  void startBridgePlayback();
  renderUi();
}

function emptyBuildStatus(): BridgeBuildStatus {
  return {
    activeProfile: "debug",
    requestedProfile: "debug",
    building: false,
    releaseReady: false,
    armed: false,
    lastStatus: "cold",
    lastMessage: "Bridge build status cold",
    releasePath: "target/release/euther-oxide",
    updatedUnixMs: 0,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function scheduleBridgeRetry(): void {
  if (isTauri || bridgeRetryTimer !== null || ui.runtime === "bridge") {
    return;
  }
  bridgeRetryTimer = window.setInterval(() => void retryBridgeConnection(), 1500);
}

function stopBridgeRetry(): void {
  if (bridgeRetryTimer !== null) {
    window.clearInterval(bridgeRetryTimer);
    bridgeRetryTimer = null;
  }
}

async function retryBridgeConnection(): Promise<void> {
  if (ui.runtime === "bridge") {
    stopBridgeRetry();
    return;
  }
  if (lastBrowserFile && ui.loaded) {
    if (romBytes.length === 0) {
      romBytes = new Uint8Array(await lastBrowserFile.arrayBuffer());
    }
    if (await loadBytesThroughBridge(lastBrowserFile.name, romBytes)) {
      stopBridgeRetry();
    }
    return;
  }
  if (romBytes.length > 0 && ui.loaded) {
    if (await loadBytesThroughBridge(romDisplayName, romBytes)) {
      stopBridgeRetry();
    }
    return;
  }
  if (await connectBridge(false)) {
    stopBridgeRetry();
  }
}

async function bridgeJson<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs = 0,
): Promise<T> {
  const response = await bridgeRequest(path, init, timeoutMs);
  const contentType = response.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    const body = await response.text();
    if (body.includes("/api/login") || body.includes("<form")) {
      throw new Error("login required");
    }
    throw new Error(`expected JSON from ${path}, got ${contentType || "unknown response"}`);
  }
  return (await response.json()) as T;
}

async function refreshLobby(): Promise<void> {
  if (isTauri) {
    return;
  }
  try {
    lobbyStatus = await bridgeJson<LobbyStatus>("/api/lobby", {}, 900);
    if (
      lobbyStatus.instances.length > 0 &&
      !lobbyStatus.instances.some((instance) => instance.id === activeLobbyInstanceId)
    ) {
      activeLobbyInstanceId = lobbyStatus.instances[0].id;
    }
    renderLobby();
  } catch {
    lobbyMeta.textContent = "Host lobby unavailable";
  }
}

async function refreshAuthStatus(): Promise<void> {
  if (isTauri) {
    return;
  }
  const previousUser = hostUsername;
  try {
    const status = await bridgeJson<AuthStatus>("/api/auth/status", {}, 700);
    hostUsername = status.authenticated ? status.user ?? null : null;
    hostIsAdmin = Boolean(status.authenticated && status.isAdmin);
    hostCsrfToken = status.authenticated ? status.csrfToken ?? null : null;
    hostPermissions = status.authenticated && status.permissions
      ? status.permissions
      : {
          canPlay: false,
          canLaunchRoms: false,
          canUploadRoms: false,
          canManageLibrary: false,
          canAwardEutherium: false,
        };
    updateChatPolling(status.authenticated);
    if (!status.authenticated) {
      void leaveVideoChat(false);
    }
  } catch {
    hostUsername = null;
    hostIsAdmin = false;
    hostCsrfToken = null;
    hostPermissions = {
      canPlay: false,
      canLaunchRoms: false,
      canUploadRoms: false,
      canManageLibrary: false,
      canAwardEutherium: false,
    };
    updateChatPolling(false);
    void leaveVideoChat(false);
  }
  renderAdminAccess();
  if (previousUser !== hostUsername) {
    shoppingListLoaded = false;
    eutheriumLoaded = false;
    eutheriumMe = null;
    eutheriumLobbyBalance = null;
    eutheriumLobbyAwards = [];
    eutheriumLobbyStatus = "Not loaded";
    selectedTrophyInventoryId = null;
    interactionUsersLoaded = false;
    interactionUsers = [];
    userPreferencesLoadedFor = null;
    userPreferencesLoadingFor = null;
    if (hostUsername) {
      void loadUserPreferences();
    }
  }
  if (hostUsername && userPreferencesLoadedFor !== hostUsername) {
    void loadUserPreferences();
  }
  renderUserMenu();
  renderInteractionUsers();
  renderEutheriumLobby();
  if (appRoute === "interactionLobby") {
    void loadInteractionUsers();
  }
  renderVideoChat();
}

type LobbyRenderOptions = {
  startRenderer?: boolean;
};

async function selectLobbyInstance(instanceId: string, options: LobbyRenderOptions = {}): Promise<void> {
  const shouldStartRenderer = options.startRenderer !== false;
  if (instanceId === activeLobbyInstanceId) {
    renderLobby();
    const kind = activeLobbyInstance()?.kind;
    if (kind === "eutherdoom") {
      await refreshDoomStatus();
    } else if (kind === "eutheralert" && shouldStartRenderer) {
      await startEutherAlertRenderer();
    } else if (kind !== "eutheralert") {
      await connectBridge(false);
    }
    return;
  }

  const previousInstanceId = activeLobbyInstanceId;
  await leaveVideoChat(true, previousInstanceId);
  activeLobbyInstanceId = instanceId;
  lobbyRole = "spectator";
  claimedLobbyPlayer = null;
  setDoomDriveActive(false);
  stopBridgeStream();
  await releaseLobbySlot(false, previousInstanceId);
  renderLobby();
  const kind = activeLobbyInstance()?.kind;
  if (kind === "eutherdoom") {
    await refreshDoomStatus();
  } else if (kind === "eutheralert" && shouldStartRenderer) {
    await startEutherAlertRenderer();
  } else if (kind !== "eutheralert") {
    await connectBridge(false);
  }
}

async function startLobbyInstance(
  kind: "megadrive" | "eutheralert" | "eutherdoom" = "megadrive",
  options: LobbyRenderOptions = {},
): Promise<void> {
  const shouldStartRenderer = options.startRenderer !== false;
  navigateApp(kind);
  await leaveVideoChat(true, activeLobbyInstanceId);
  const result = await bridgeJson<LobbyStartResult>(
    `/api/lobby/start?kind=${encodeURIComponent(kind)}`,
    { method: "POST" },
    1200,
  );
  lobbyStatus = result.instance;
  activeLobbyInstanceId = result.id;
  lobbyRole = "spectator";
  claimedLobbyPlayer = null;
  pushTrace(
    kind === "eutherdoom"
      ? "New Doom server primed"
      : kind === "eutheralert"
        ? "New EutherAlert vessel primed"
        : "New host instance primed",
  );
  renderLobby();
  await joinLobbyInstance(1, { startRenderer: shouldStartRenderer });
  if (kind === "eutherdoom") {
    await refreshDoomStatus();
  }
  if (kind === "eutheralert" && shouldStartRenderer) {
    await startEutherAlertRenderer();
  }
  if (kind === "megadrive") {
    await connectBridge(false);
  }
}

async function startEutherAlertAsServer(): Promise<void> {
  await requestEutherAlertFullscreen(true);
  await startLobbyInstance("eutheralert", { startRenderer: false });
  await joinLobbyInstance(1, { startRenderer: false });
  try {
    await startEutherAlertOpenRa();
    await startEutherAlertOpenRaClient();
  } catch (err) {
    eutherAlertOpenRaStatus.textContent = err instanceof Error ? err.message : "OpenRA start failed";
  }
  await startEutherAlertRenderer();
}

async function joinLobbyInstance(port: PlayerPort | "auto" = "auto", options: LobbyRenderOptions = {}): Promise<void> {
  const shouldStartRenderer = options.startRenderer !== false;
  const result = await bridgeJson<LobbyJoinResult>(
    `/api/lobby/join?instance=${encodeURIComponent(activeLobbyInstanceId)}&player=${port}`,
    { method: "POST" },
    1200,
  );
  lobbyStatus = result.instance;
  if (result.role.kind === "player" && (result.role.player === 1 || result.role.player === 2)) {
    lobbyRole = "player";
    claimedLobbyPlayer = result.role.player;
    setPlayerPort(claimedLobbyPlayer);
    pushTrace(`Joined as P${result.role.player}`);
  } else {
    lobbyRole = "spectator";
    claimedLobbyPlayer = null;
    setDoomDriveActive(false);
    stopBridgeStream();
    pushTrace("Joined as spectator");
  }
  renderLobby();
  if (activeLobbyInstance()?.kind === "eutherdoom") {
    await refreshDoomStatus();
  } else if (activeLobbyInstance()?.kind === "eutheralert" && shouldStartRenderer) {
    await startEutherAlertRenderer();
  }
}

async function spectateActiveLobbyInstance(): Promise<void> {
  lobbyRole = "spectator";
  claimedLobbyPlayer = null;
  setDoomDriveActive(false);
  stopBridgeStream();
  await releaseLobbySlot(false);
  renderLobby();
  if (activeLobbyInstance()?.kind === "eutheralert") {
    await startEutherAlertRenderer();
  }
}

async function ensureHostedLobbyInstance(): Promise<void> {
  if (!hostedServerMode || !hostUsername) {
    return;
  }
  await refreshLobby();
  const active = activeLobbyInstance();
  if (active) {
    if (!active.players.some((slot) => slot.user === hostUsername)) {
      await joinLobbyInstance();
    }
    return;
  }
  if (hostPermissions.canPlay) {
    await startLobbyInstance("megadrive");
  }
}

async function releaseLobbySlot(announce = true, instanceId = activeLobbyInstanceId): Promise<void> {
  lobbyStatus = await bridgeJson<LobbyStatus>(
    `/api/lobby/release?instance=${encodeURIComponent(instanceId)}`,
    { method: "POST" },
    1200,
  );
  if (announce) {
    lobbyRole = "spectator";
    claimedLobbyPlayer = null;
    stopBridgeStream();
    pushTrace("Released player slot");
  }
  renderLobby();
  if (activeLobbyInstance()?.kind === "eutherdoom") {
    await refreshDoomStatus();
  }
}

async function kickLobbyPlayer(player: PlayerPort): Promise<void> {
  lobbyStatus = await bridgeJson<LobbyStatus>(
    `/api/lobby/kick?instance=${encodeURIComponent(activeLobbyInstanceId)}&player=${player}`,
    { method: "POST" },
    1200,
  );
  pushTrace(`Kicked P${player}`);
  renderLobby();
  if (activeLobbyInstance()?.kind === "eutherdoom") {
    await refreshDoomStatus();
  }
}

async function closeLobbyInstance(): Promise<void> {
  const closingId = activeLobbyInstanceId;
  await leaveVideoChat(true, closingId);
  lobbyStatus = await bridgeJson<LobbyStatus>(
    `/api/lobby/close?instance=${encodeURIComponent(closingId)}`,
    { method: "POST" },
    1200,
  );
  const fallback = lobbyStatus.instances.find((instance) => instance.id !== closingId);
  activeLobbyInstanceId = fallback?.id ?? "main";
  lobbyRole = "spectator";
  claimedLobbyPlayer = null;
  setDoomDriveActive(false);
  stopBridgeStream();
  pushTrace(`Closed ${closingId}`);
  renderLobby();
  if (activeLobbyInstance()?.kind !== "eutherdoom") {
    await connectBridge(false);
  }
}

async function refreshDoomStatus(): Promise<void> {
  const instance = activeLobbyInstance();
  if (instance?.kind !== "eutherdoom") {
    doomStatus = null;
    doomLastEventId = 0;
    setDoomEventPolling(false);
    renderDoomPanel();
    return;
  }
  try {
    doomStatus = await bridgeJson<DoomStatus>("/api/doom/status", {}, 900);
    doomLastEventId = doomStatus.lastEventId ?? doomLastEventId;
    startDoomEventStream();
  } catch (err) {
    doomStatus = null;
    setDoomEventPolling(false);
    doomMeta.textContent = err instanceof Error ? err.message : "Doom status unavailable";
  }
  renderDoomPanel();
}

function setDoomEventPolling(active: boolean): void {
  if (!active) {
    stopDoomEventStream();
  }
  if (!active) {
    if (doomEventPollTimer !== null) {
      window.clearInterval(doomEventPollTimer);
      doomEventPollTimer = null;
    }
    return;
  }
  if (doomEventPollTimer !== null) {
    return;
  }
  doomEventPollTimer = window.setInterval(() => {
    void pollDoomEvents();
  }, 500);
}

function startDoomEventStream(): void {
  if (doomEventStream || activeLobbyInstance()?.kind !== "eutherdoom") {
    return;
  }
  if (doomEventPollTimer !== null) {
    window.clearInterval(doomEventPollTimer);
    doomEventPollTimer = null;
  }
  doomEventStream = new EventSource(bridgeUrl(`/api/doom/stream?after=${doomLastEventId}`), {
    withCredentials: true,
  });
  doomEventStream.onmessage = (event) => {
    try {
      const doomEvent = JSON.parse(event.data) as DoomServerEvent;
      doomLastEventId = Math.max(doomLastEventId, Number(doomEvent.id ?? 0));
      applyDoomEvents([doomEvent]);
      renderLobby();
    } catch (err) {
      doomMeta.textContent = err instanceof Error ? err.message : "Doom stream parse failed";
    }
  };
  doomEventStream.onerror = () => {
    stopDoomEventStream();
    if (activeLobbyInstance()?.kind === "eutherdoom") {
      setDoomEventPolling(true);
    }
  };
}

function stopDoomEventStream(): void {
  doomEventStream?.close();
  doomEventStream = null;
}

async function pollDoomEvents(): Promise<void> {
  if (activeLobbyInstance()?.kind !== "eutherdoom") {
    setDoomEventPolling(false);
    return;
  }
  try {
    const result = await bridgeJson<DoomEventsResult>(
      `/api/doom/events?after=${doomLastEventId}`,
      {},
      700,
    );
    doomLastEventId = result.lastEventId;
    if (result.events.length > 0) {
      applyDoomEvents(result.events);
      renderLobby();
    }
  } catch {
    setDoomEventPolling(false);
  }
}

function applyDoomEvents(events: DoomServerEvent[]): void {
  if (!doomStatus) {
    return;
  }
  for (const event of events) {
    switch (event.type) {
      case "playerJoined":
      case "playerClaimed":
        upsertDoomPlayer(event.player, event.user, false);
        setLobbyPlayerSlot(event.player, true, event.user);
        break;
      case "playerReady":
        setDoomPlayerReady(event.player, event.ready);
        break;
      case "playerLeft":
        doomStatus.players = doomStatus.players.filter((player) => player.player !== event.player);
        setLobbyPlayerSlot(event.player, false);
        if (event.player === claimedLobbyPlayer) {
          claimedLobbyPlayer = null;
          lobbyRole = "spectator";
          setDoomDriveActive(false);
          pushTrace("Doom slot released");
        }
        break;
      case "ticFrame":
        doomStatus.frames = [...doomStatus.frames, { tic: event.tic, commands: event.commands }].slice(-8);
        doomStatus.currentTic = Math.max(doomStatus.currentTic, event.tic + 1);
        doomStatus.replayEvents = (doomStatus.replayEvents ?? 0) + 2;
        doomTic.value = doomStatus.currentTic.toString();
        break;
      case "reset":
        doomStatus.currentTic = 0;
        doomStatus.frames = [];
        doomStatus.players = doomStatus.players.map((player) => ({ ...player, ready: false }));
        doomTic.value = "0";
        break;
      case "playerHeartbeat":
        break;
    }
  }
}

function setLobbyPlayerSlot(player: number, occupied: boolean, user: string | null = null): void {
  const instance = activeLobbyInstance();
  if (!instance || instance.kind !== "eutherdoom") {
    return;
  }
  const slot = instance.players.find((entry) => entry.player === player);
  if (!slot) {
    return;
  }
  slot.occupied = occupied;
  slot.user = occupied ? user : null;
}

function upsertDoomPlayer(player: number, user: string, ready: boolean): void {
  if (!doomStatus) {
    return;
  }
  const existing = doomStatus.players.find((entry) => entry.player === player);
  if (existing) {
    existing.user = user;
    existing.ready = ready;
  } else {
    doomStatus.players = [...doomStatus.players, { player, user, ready }].sort((a, b) => a.player - b.player);
  }
}

function setDoomPlayerReady(player: number, ready: boolean): void {
  if (!doomStatus) {
    return;
  }
  const existing = doomStatus.players.find((entry) => entry.player === player);
  if (existing) {
    existing.ready = ready;
  }
}

function loadExternalStylesheet(id: string, href: string): void {
  if (document.getElementById(id)) {
    return;
  }
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

function loadExternalScript(id: string, src: string): Promise<void> {
  if (document.getElementById(id)) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.id = id;
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(script);
  });
}

async function ensureEutherDoomRuntime(): Promise<void> {
  loadExternalStylesheet("eutherdoom-jsdos-css", "/eutherdoom-runtime/js-dos/js-dos.css");
  if (!doomRuntimeScriptPromise) {
    doomRuntimeScriptPromise = loadExternalScript("eutherdoom-jsdos-js", "/eutherdoom-runtime/js-dos/js-dos.js");
  }
  await doomRuntimeScriptPromise;
}

async function startEutherDoomRenderer(): Promise<void> {
  eutherDoomRenderer.setAttribute("aria-hidden", "false");
  if (doomRendererStarted) {
    return;
  }
  doomRendererStarted = true;
  eutherDoomRendererStatus.textContent = "Loading Doom runtime";
  eutherDoomDos.innerHTML = "";
  try {
    await ensureEutherDoomRuntime();
    if (!window.Dos) {
      throw new Error("js-dos runtime missing");
    }
    eutherDoomRendererStatus.textContent = "Starting Doom";
    doomRendererController = window.Dos(eutherDoomDos, {
      url: "/eutherdoom-runtime/bundles/doom.jsdos",
      pathPrefix: "/eutherdoom-runtime/js-dos/emulators/",
      autoStart: true,
      noCloud: true,
      kiosk: true,
      workerThread: true,
      renderAspect: "fit",
      mouseSensitivity: doomMouseSensitivity,
    });
    eutherDoomRendererStatus.textContent = "Doom running";
  } catch (err) {
    doomRendererStarted = false;
    eutherDoomRendererStatus.textContent = err instanceof Error ? err.message : "Doom runtime failed";
  }
}

async function stopEutherDoomRenderer(): Promise<void> {
  eutherDoomRenderer.setAttribute("aria-hidden", "true");
  if (!doomRendererStarted) {
    return;
  }
  doomRendererStarted = false;
  try {
    await doomRendererController?.stop?.();
  } catch {
    // Runtime teardown is best-effort; route switches must not get stuck.
  }
  doomRendererController = null;
  eutherDoomDos.innerHTML = "";
  eutherDoomRendererStatus.textContent = "Doom runtime idle";
}

async function startEutherDukeRenderer(): Promise<void> {
  eutherDukeRenderer.setAttribute("aria-hidden", "false");
  eutherDukeRuntimePanel.hidden = false;
  eutherDukeFrame.hidden = true;
  try {
    const response = await fetch("/eutherduke-runtime/index.html", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("EutherDuke runtime not installed");
    }
    eutherDukeRuntimePanel.hidden = true;
    eutherDukeFrame.hidden = false;
    const runtimeParams = new URLSearchParams({
      v: Date.now().toString(),
      mouseSensitivity: doomMouseSensitivity.toFixed(1),
    });
    const runtimeUrl = `/eutherduke-runtime/index.html?${runtimeParams.toString()}`;
    eutherDukeFrame.src = runtimeUrl;
  } catch {
    eutherDukeFrame.removeAttribute("src");
    eutherDukeFrame.hidden = true;
    eutherDukeRuntimePanel.hidden = false;
  }
}

function stopEutherDukeRenderer(): void {
  eutherDukeRenderer.setAttribute("aria-hidden", "true");
  eutherDukeFrame.hidden = true;
}

async function startEutherAlertRenderer(): Promise<void> {
  const startToken = ++eutherAlertRendererStartToken;
  eutherAlertRenderer.setAttribute("aria-hidden", "false");
  eutherAlertRuntimePanel.hidden = false;
  eutherAlertFrame.hidden = true;
  eutherAlertRuntimeTitle.textContent = "Starting EutherAlert runtime";
  eutherAlertRuntimeMessage.textContent = "Opening the EutherAlert runtime and preparing the OpenRA bridge.";
  try {
    if (activeLobbyInstance()?.kind !== "eutheralert") {
      throw new Error("Select or start an EutherAlert vessel first");
    }
    if (startToken !== eutherAlertRendererStartToken) {
      return;
    }
    const runtimeParams = new URLSearchParams({
      v: Date.now().toString(),
      instance: activeLobbyInstanceId,
      client: bridgeClientId,
      player: claimedLobbyPlayer?.toString() ?? "",
      role: lobbyRole,
      csrf: hostCsrfToken ?? "",
    });
    eutherAlertRuntimePanel.hidden = true;
    eutherAlertFrame.hidden = false;
    eutherAlertFrame.src = `/eutheralert/index.html?${runtimeParams.toString()}`;
    void ensureEutherAlertOpenRaLive().catch((err) => {
      eutherAlertOpenRaStatus.textContent = err instanceof Error ? err.message : "OpenRA autostart failed";
    });
  } catch (err) {
    if (startToken !== eutherAlertRendererStartToken) {
      return;
    }
    eutherAlertRuntimeTitle.textContent = "EutherAlert runtime could not start";
    eutherAlertRuntimeMessage.textContent = err instanceof Error ? err.message : "Runtime request failed";
    eutherAlertFrame.removeAttribute("src");
    eutherAlertFrame.hidden = true;
    eutherAlertRuntimePanel.hidden = false;
  }
}

function stopEutherAlertRenderer(): void {
  eutherAlertRendererStartToken += 1;
  eutherAlertRenderer.setAttribute("aria-hidden", "true");
  eutherAlertFrame.hidden = true;
}

function eutherAlertOpenRaQuery(): string {
  return `?instance=${encodeURIComponent(activeLobbyInstanceId)}`;
}

function eutherAlertOpenRaProcessMatches(status: AlertOpenRaStatus | undefined): boolean {
  return Boolean(status?.running && status.instance === activeLobbyInstanceId);
}

async function requestEutherAlertFullscreen(silent = false): Promise<void> {
  const target = eutherAlertRenderer;
  const request = target.requestFullscreen?.bind(target);
  if (!request || document.fullscreenElement) {
    return;
  }
  try {
    await request();
  } catch (err) {
    if (!silent) {
      eutherAlertOpenRaStatus.textContent = err instanceof Error ? err.message : "Fullscreen unavailable";
    }
  }
}

function renderEutherAlertOpenRaStatus(status: AlertOpenRaStatus): void {
  const bridgeLabel = status.touchBridge?.running
    ? " | touch bridge on"
    : status.touchBridge?.configured
      ? " | touch bridge ready"
      : "";
  const clientLabel = status.client?.running
    ? ` | client ${status.client.display ?? "display ?"} ${status.client.captureWidth ?? "?"}x${status.client.captureHeight ?? "?"}`
    : status.client?.exited
      ? ` | client exited${status.client.code === null || status.client.code === undefined ? "" : ` (${status.client.code})`}`
      : " | client idle";
  if (status.running) {
    eutherAlertOpenRaStatus.textContent = `Server on LAN port ${status.port ?? "?"}${clientLabel}${bridgeLabel}`;
  } else if (status.exited) {
    eutherAlertOpenRaStatus.textContent = `Server exited${status.code === null || status.code === undefined ? "" : ` (${status.code})`}${clientLabel}`;
  } else {
    eutherAlertOpenRaStatus.textContent = `Server idle${clientLabel} | ${status.runtimePath ?? ".euther-openra/OpenRA"}${bridgeLabel}`;
  }
  eutherAlertOpenRaStart.disabled = Boolean(status.running);
  eutherAlertOpenRaStop.disabled = !status.running;
  eutherAlertOpenRaClientStart.disabled = Boolean(status.client?.running);
  eutherAlertOpenRaClientStop.disabled = !status.client?.running;
}

async function refreshEutherAlertOpenRaStatus(): Promise<void> {
  try {
    const status = await bridgeJson<AlertOpenRaStatus>(`/api/eutheralert/openra/status${eutherAlertOpenRaQuery()}`, {}, 1200);
    renderEutherAlertOpenRaStatus(status);
  } catch {
    eutherAlertOpenRaStatus.textContent = "OpenRA status unavailable";
    eutherAlertOpenRaStart.disabled = false;
    eutherAlertOpenRaStop.disabled = true;
    eutherAlertOpenRaClientStart.disabled = false;
    eutherAlertOpenRaClientStop.disabled = true;
  }
}

async function startEutherAlertOpenRa(): Promise<void> {
  try {
    const status = await bridgeJson<AlertOpenRaStatus>(`/api/eutheralert/openra/start${eutherAlertOpenRaQuery()}`, { method: "POST" }, 2000);
    renderEutherAlertOpenRaStatus(status);
    pushTrace(`OpenRA Red Alert server on port ${status.port ?? "?"}`);
  } catch (err) {
    eutherAlertOpenRaStatus.textContent = err instanceof Error ? err.message : "OpenRA start failed";
  }
}

async function stopEutherAlertOpenRa(): Promise<void> {
  try {
    const status = await bridgeJson<AlertOpenRaStatus>(`/api/eutheralert/openra/stop${eutherAlertOpenRaQuery()}`, { method: "POST" }, 2000);
    renderEutherAlertOpenRaStatus(status);
    pushTrace("OpenRA Red Alert server stopped");
  } catch (err) {
    eutherAlertOpenRaStatus.textContent = err instanceof Error ? err.message : "OpenRA stop failed";
  }
}

async function startEutherAlertOpenRaClient(): Promise<void> {
  try {
    const client = await bridgeJson<AlertOpenRaStatus>(`/api/eutheralert/openra/client/start${eutherAlertOpenRaQuery()}`, { method: "POST" }, 2000);
    const status = await bridgeJson<AlertOpenRaStatus>(`/api/eutheralert/openra/status${eutherAlertOpenRaQuery()}`, {}, 1200);
    renderEutherAlertOpenRaStatus({ ...status, client });
    pushTrace(`OpenRA Red Alert client connecting to port ${client.port ?? "?"}`);
  } catch (err) {
    eutherAlertOpenRaStatus.textContent = err instanceof Error ? err.message : "OpenRA client start failed";
  }
}

async function stopEutherAlertOpenRaClient(): Promise<void> {
  try {
    const client = await bridgeJson<AlertOpenRaStatus>(`/api/eutheralert/openra/client/stop${eutherAlertOpenRaQuery()}`, { method: "POST" }, 2000);
    const status = await bridgeJson<AlertOpenRaStatus>(`/api/eutheralert/openra/status${eutherAlertOpenRaQuery()}`, {}, 1200);
    renderEutherAlertOpenRaStatus({ ...status, client });
    pushTrace("OpenRA Red Alert client stopped");
  } catch (err) {
    eutherAlertOpenRaStatus.textContent = err instanceof Error ? err.message : "OpenRA client stop failed";
  }
}

async function dumpEutherAlertOpenRaDebug(): Promise<void> {
  try {
    const debug = await bridgeJson<Record<string, unknown>>(
      `/api/eutheralert/openra/client/debug${eutherAlertOpenRaQuery()}`,
      { method: "POST" },
      1600,
    );
    const client = (debug.client ?? {}) as Record<string, unknown>;
    const running = client.running ? "client running" : client.exited ? "client exited" : "client idle";
    const display = String(client.display ?? "no display");
    const socket = client.displaySocketExists ? "socket ok" : "socket missing";
    const ffmpeg = debug.ffmpegAvailable ? "ffmpeg ok" : "ffmpeg missing";
    const xvfb = debug.xvfbAvailable ? "xvfb ok" : "xvfb missing";
    const request = (debug.request ?? {}) as Record<string, unknown>;
    const instance = String(request.requestedInstance ?? activeLobbyInstanceId);
    eutherAlertOpenRaStatus.textContent = `Debug: ${running} | inst ${instance} | ${display} | ${socket} | ${ffmpeg} | ${xvfb}`;
    pushTrace(`OpenRA debug ${JSON.stringify(debug)}`);
  } catch (err) {
    eutherAlertOpenRaStatus.textContent = err instanceof Error ? err.message : "OpenRA debug failed";
  }
}

async function ensureEutherAlertOpenRaLive(): Promise<void> {
  try {
    let status = await bridgeJson<AlertOpenRaStatus>(`/api/eutheralert/openra/status${eutherAlertOpenRaQuery()}`, {}, 1600);
    if (!eutherAlertOpenRaProcessMatches(status)) {
      if (claimedLobbyPlayer !== 1) {
        eutherAlertOpenRaStatus.textContent = "Waiting for P1 server";
        return;
      }
      eutherAlertOpenRaStatus.textContent = "Starting OpenRA server as P1";
      status = await bridgeJson<AlertOpenRaStatus>(`/api/eutheralert/openra/start${eutherAlertOpenRaQuery()}`, { method: "POST" }, 5000);
    }
    if (!eutherAlertOpenRaProcessMatches(status.client)) {
      eutherAlertOpenRaStatus.textContent = "Starting OpenRA client";
      const client = await bridgeJson<AlertOpenRaStatus>(`/api/eutheralert/openra/client/start${eutherAlertOpenRaQuery()}`, { method: "POST" }, 5000);
      status = await bridgeJson<AlertOpenRaStatus>(`/api/eutheralert/openra/status${eutherAlertOpenRaQuery()}`, {}, 1600);
      renderEutherAlertOpenRaStatus({ ...status, client });
      return;
    }
    renderEutherAlertOpenRaStatus(status);
  } catch (err) {
    eutherAlertOpenRaStatus.textContent = err instanceof Error ? err.message : "OpenRA autostart failed";
    throw err;
  }
}

async function setDoomReady(ready: boolean): Promise<void> {
  if (activeLobbyInstance()?.kind !== "eutherdoom" || claimedLobbyPlayer === null) {
    pushTrace("Claim Doom P1 or P2 first");
    return;
  }
  const query = ready ? "" : "?ready=0";
  doomStatus = await bridgeJson<DoomStatus>(`/api/doom/ready${query}`, { method: "POST" }, 1200);
  doomLastEventId = doomStatus.lastEventId ?? doomLastEventId;
  pushTrace(`Doom P${claimedLobbyPlayer} ${ready ? "ready" : "unready"}`);
  setDoomDriveActive(ready);
  renderDoomPanel();
}

async function sendDoomCommand(): Promise<void> {
  if (activeLobbyInstance()?.kind !== "eutherdoom" || claimedLobbyPlayer === null) {
    pushTrace("Claim Doom P1 or P2 first");
    return;
  }
  const params = doomCommandParams(readManualDoomCommand());
  doomStatus = await bridgeJson<DoomStatus>(`/api/doom/cmd?${params}`, { method: "POST" }, 1200);
  doomLastEventId = doomStatus.lastEventId ?? doomLastEventId;
  doomTic.value = doomStatus.currentTic.toString();
  pushTrace(`Doom tic submitted`);
  renderDoomPanel();
}

function setDoomDriveActive(active: boolean): void {
  if (!active) {
    if (doomDriveTimer !== null) {
      window.clearInterval(doomDriveTimer);
      doomDriveTimer = null;
    }
    doomDriveInFlight = false;
    doomDriveSubmitted = 0;
    renderDoomPanel();
    return;
  }
  if (activeLobbyInstance()?.kind !== "eutherdoom" || claimedLobbyPlayer === null) {
    pushTrace("Claim Doom P1 or P2 first");
    renderDoomPanel();
    return;
  }
  if (doomDriveTimer !== null) {
    return;
  }
  doomDriveTimer = window.setInterval(() => {
    void driveDoomTick();
  }, 35);
  void driveDoomTick();
  renderDoomPanel();
}

async function driveDoomTick(): Promise<void> {
  if (doomDriveInFlight) {
    return;
  }
  if (activeLobbyInstance()?.kind !== "eutherdoom" || claimedLobbyPlayer === null) {
    setDoomDriveActive(false);
    return;
  }
  doomDriveInFlight = true;
  try {
    const command = doomCommandFromInput();
    const params = doomCommandParams(command);
    params.set("compact", "1");
    await bridgeRequest(`/api/doom/cmd?${params}`, { method: "POST" }, 450);
    doomDriveSubmitted = command.tic;
    renderDoomPanel();
  } catch (err) {
    try {
      await refreshDoomStatus();
      doomTic.value = String(doomStatus?.currentTic ?? numberInput(doomTic, 0));
    } catch {
      setDoomDriveActive(false);
      pushTrace(err instanceof Error ? err.message : "Doom drive stopped");
    }
  } finally {
    doomDriveInFlight = false;
  }
}

function readManualDoomCommand(): DoomCommand {
  return {
    tic: numberInput(doomTic, 0),
    forward: numberInput(doomForward, 0),
    strafe: numberInput(doomStrafe, 0),
    turn: numberInput(doomTurn, 0),
    buttons: numberInput(doomButtons, 0),
    weapon: numberInput(doomWeapon, 0),
  };
}

function doomCommandFromInput(): DoomCommand {
  const strafeMode = inputState.c;
  const leftRight = Number(inputState.right) - Number(inputState.left);
  const buttons =
    Number(inputState.a) |
    (Number(inputState.b) << 1) |
    (Number(inputState.start) << 2);
  return {
    tic: doomStatus?.currentTic ?? numberInput(doomTic, 0),
    forward: clampDoomNumber(Number(inputState.up) * 50 - Number(inputState.down) * 50, -127, 127),
    strafe: strafeMode ? clampDoomNumber(leftRight * 45, -127, 127) : 0,
    turn: strafeMode ? 0 : clampDoomNumber(leftRight * 768, -32768, 32767),
    buttons,
    weapon: clampDoomNumber(numberInput(doomWeapon, 0), 0, 255),
  };
}

function doomCommandParams(command: DoomCommand): URLSearchParams {
  return new URLSearchParams({
    tic: command.tic.toString(),
    forward: command.forward.toString(),
    strafe: command.strafe.toString(),
    turn: command.turn.toString(),
    buttons: command.buttons.toString(),
    weapon: command.weapon.toString(),
  });
}

function clampDoomNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

async function resetDoomMatch(): Promise<void> {
  if (activeLobbyInstance()?.kind !== "eutherdoom") {
    return;
  }
  doomStatus = await bridgeJson<DoomStatus>("/api/doom/reset", { method: "POST" }, 1200);
  doomLastEventId = doomStatus.lastEventId ?? doomLastEventId;
  doomTic.value = "0";
  pushTrace("Doom match reset");
  renderDoomPanel();
}

async function downloadDoomReplay(): Promise<void> {
  if (activeLobbyInstance()?.kind !== "eutherdoom") {
    return;
  }
  const response = await bridgeRequest("/api/doom/replay", {}, 1200);
  const replay = await response.text();
  const blob = new Blob([replay], { type: "text/plain" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = `${activeLobbyInstanceId}-doom.replay.txt`;
  link.click();
  URL.revokeObjectURL(url);
  pushTrace("Doom replay exported");
}

function numberInput(input: HTMLInputElement, fallback: number): number {
  const value = Number(input.value);
  return Number.isFinite(value) ? Math.trunc(value) : fallback;
}

async function refreshHostUsers(): Promise<void> {
  if (isTauri) {
    return;
  }
  try {
    const result = await bridgeJson<HostUserList>("/api/admin/users", {}, 900);
    hostUsers = result.users;
    renderHostUsers();
  } catch {
    adminUsers.innerHTML = `<span>Host admin unavailable</span>`;
  }
}

async function addOrResetHostUser(): Promise<void> {
  const username = adminUsername.value.trim();
  const password = adminPassword.value;
  if (!username || !password) {
    return;
  }
  const existing = hostUsers.some((user) => user.name === username);
  const body = new URLSearchParams({ username, password });
  const result = await bridgeJson<HostUserList>(
    existing ? "/api/admin/users/password" : "/api/admin/users/create",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
    1600,
  );
  hostUsers = result.users;
  selectedAdminUser = username;
  adminPassword.value = "";
  renderHostUsers();
}

async function sendInvitePlaceholder(): Promise<void> {
  const email = inviteEmail.value.trim();
  if (!email) {
    return;
  }
  await bridgeJson(
    "/api/admin/invites/placeholder",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email }),
    },
    900,
  );
  pushTrace("Invite placeholder logged");
}

async function awardEutheriumFromAdminPanel(): Promise<void> {
  const userId = adminAwardUser.value.trim();
  const amount = numberInput(adminAwardAmount, 0);
  const reason = adminAwardReason.value.trim();
  if (!userId || amount <= 0 || !reason) {
    adminAwardStatus.textContent = "Choose user, amount and reason";
    return;
  }
  adminAwardSend.disabled = true;
  adminAwardStatus.textContent = "Writing ledger";
  try {
    const result = await bridgeJson<unknown>(
      "/api/eutherium/award",
      {
        method: "POST",
        body: JSON.stringify({ userId, amount, reason, source: "manual_award" }),
      },
      1400,
    );
    if (hostIsAdmin && isEutheriumAdminResult(result)) {
      eutheriumAdmin = result;
    }
    adminAwardReason.value = "";
    adminAwardStatus.textContent = `Awarded ${amount} to ${displayUserName(userId)}`;
    eutheriumLoaded = false;
    if (activeWorkspaceWindow === "eutherium") {
      await loadEutherium();
    }
    await loadEutheriumLobby(true);
  } catch (err) {
    adminAwardStatus.textContent = err instanceof Error ? err.message : "Award failed";
  } finally {
    adminAwardSend.disabled = false;
  }
}

async function awardEutheriumFromWorkspace(): Promise<void> {
  const userInput = workspaceWindowDynamic.querySelector<HTMLSelectElement>("#eutherium-award-user");
  const amountInput = workspaceWindowDynamic.querySelector<HTMLInputElement>("#eutherium-award-amount");
  const reasonInput = workspaceWindowDynamic.querySelector<HTMLInputElement>("#eutherium-award-reason");
  const userId = userInput?.value.trim() ?? "";
  const amount = amountInput ? numberInput(amountInput, 0) : 0;
  const reason = reasonInput?.value.trim() ?? "";
  if (!userId || amount <= 0 || !reason) {
    eutheriumStatus = "Choose user, amount and reason";
    renderWorkspaceWindow();
    return;
  }
  eutheriumSaving = true;
  eutheriumStatus = "Writing ledger";
  renderWorkspaceWindow();
  try {
    const result = await bridgeJson<unknown>(
      "/api/eutherium/award",
      {
        method: "POST",
        body: JSON.stringify({ userId, amount, reason, source: "manual_award" }),
      },
      1400,
    );
    if (hostIsAdmin && isEutheriumAdminResult(result)) {
      eutheriumAdmin = result;
    }
    eutheriumLoaded = false;
    eutheriumStatus = `Awarded ${amount} to ${displayUserName(userId)}`;
    await loadEutheriumLobby(true);
    await loadEutherium(true);
  } catch (err) {
    eutheriumStatus = err instanceof Error ? err.message : "Award failed";
  } finally {
    eutheriumSaving = false;
    renderWorkspaceWindow();
  }
}

async function awardEutheriumFromLobby(): Promise<void> {
  const userInput = eutheriumLobbyAwardEl.querySelector<HTMLSelectElement>("#eutherium-lobby-award-user");
  const amountInput = eutheriumLobbyAwardEl.querySelector<HTMLInputElement>("#eutherium-lobby-award-amount");
  const reasonInput = eutheriumLobbyAwardEl.querySelector<HTMLInputElement>("#eutherium-lobby-award-reason");
  const userId = userInput?.value.trim() ?? "";
  const amount = amountInput ? numberInput(amountInput, 0) : 0;
  const reason = reasonInput?.value.trim() ?? "";
  if (!userId || amount <= 0 || !reason) {
    eutheriumLobbyStatus = "Choose user, amount and reason";
    renderEutheriumLobby();
    return;
  }
  eutheriumLobbyStatus = "Writing ledger";
  renderEutheriumLobby();
  try {
    await bridgeJson<unknown>(
      "/api/eutherium/award",
      {
        method: "POST",
        body: JSON.stringify({ userId, amount, reason, source: "manual_award" }),
      },
      1400,
    );
    eutheriumLobbyStatus = `Awarded ${amount} to ${displayUserName(userId)}`;
    eutheriumLoaded = false;
    await loadEutheriumLobby(true);
  } catch (err) {
    eutheriumLobbyStatus = err instanceof Error ? err.message : "Award failed";
    renderEutheriumLobby();
  }
}

function updateChatPolling(enabled: boolean): void {
  if (isTauri || !enabled) {
    if (chatPollTimer !== null) {
      window.clearInterval(chatPollTimer);
      chatPollTimer = null;
    }
    return;
  }
  if (chatPollTimer === null) {
    void refreshChat();
    chatPollTimer = window.setInterval(() => void refreshChat(), 2200);
  }
}

async function refreshChat(): Promise<void> {
  if (isTauri) {
    return;
  }
  try {
    const result = await bridgeJson<ChatResult>("/api/chat", {}, 900);
    chatMessages = result.messages;
    renderChat();
  } catch {
    chatList.innerHTML = `<span>Chat offline</span>`;
  }
}

async function sendChatMessage(): Promise<void> {
  const message = chatInput.value.trim();
  if (!message) {
    return;
  }
  const result = await bridgeJson<ChatResult>(
    "/api/chat",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ message }),
    },
    1200,
  );
  chatMessages = result.messages;
  chatInput.value = "";
  renderChat();
}

function readAppRoute(): AppRoute {
  const route = window.location.hash.replace(/^#\/?/, "").toLowerCase();
  if (route === "") {
    return defaultAppRoute();
  }
  return appRouteFromToken(route) ?? defaultAppRoute();
}

function defaultAppRoute(): AppRoute {
  if (forceMegaDriveStartup) {
    return "megadrive";
  }
  if (autoStartEutherDogs) {
    return "eutherdogs";
  }
  return "playHome";
}

function appRouteFromToken(token: string | undefined): AppRoute | null {
  switch (token) {
    case "core":
    case "play":
    case "play-home":
      return "playHome";
    case "interaction-lobby":
    case "social":
      return "interactionLobby";
    case "megadrive":
    case "play/megadrive":
      return "megadrive";
    case "eutherdogs":
    case "play/eutherdogs":
      return "eutherdogs";
    case "euthercivet":
    case "civet":
    case "play/euthercivet":
    case "play/civet":
      return "euthercivet";
    case "eutheralert":
    case "alert":
    case "redalert":
    case "ra":
    case "play/eutheralert":
    case "play/alert":
    case "play/redalert":
    case "play/ra":
      return "eutheralert";
    case "eutherdoom":
    case "utherdoom":
    case "play/eutherdoom":
    case "play/utherdoom":
      return "eutherdoom";
    case "eutherduke":
    case "duke":
    case "play/eutherduke":
    case "play/duke":
      return "eutherduke";
    default:
      return null;
  }
}

function appRouteHash(route: AppRoute): string {
  switch (route) {
    case "interactionLobby":
      return "/interaction-lobby";
    case "playHome":
      return "/play";
    default:
      return `/play/${route}`;
  }
}

function navigateApp(route: AppRoute): void {
  const hash = appRouteHash(route);
  if (window.location.hash === `#${hash}`) {
    applyAppRoute();
    return;
  }
  window.location.hash = hash;
}

function applyAppRoute(): void {
  appRoute = readAppRoute();
  const showingLobby = appRoute === "interactionLobby";
  const playMode = currentPlayModeRoute();
  reactionCorePage.hidden = showingLobby;
  interactionLobbyPage.hidden = !showingLobby;
  document.body.classList.toggle("interaction-lobby-mode", showingLobby);
  document.body.classList.toggle("play-home-mode", !showingLobby && appRoute === "playHome");
  document.body.classList.toggle("play-mode-megadrive", !showingLobby && appRoute === "megadrive");
  document.body.classList.toggle("play-mode-eutherdogs", !showingLobby && appRoute === "eutherdogs");
  document.body.classList.toggle("play-mode-euthercivet", !showingLobby && appRoute === "euthercivet");
  document.body.classList.toggle("play-mode-eutheralert", !showingLobby && appRoute === "eutheralert");
  document.body.classList.toggle("play-mode-eutherdoom", !showingLobby && appRoute === "eutherdoom");
  document.body.classList.toggle("play-mode-eutherduke", !showingLobby && appRoute === "eutherduke");

  playHomePanel.hidden = showingLobby || appRoute !== "playHome";
  reactionLobbyHome.hidden = showingLobby || appRoute !== "playHome";
  lobbySection.hidden =
    showingLobby || (appRoute !== "megadrive" && appRoute !== "eutheralert" && appRoute !== "eutherdoom");
  dogsModeSection.hidden = showingLobby || appRoute !== "eutherdogs";
  civetModeSection.hidden = showingLobby || appRoute !== "euthercivet";
  megaDrivePanel.hidden = showingLobby || appRoute !== "megadrive";
  if (appRoute === "megadrive") {
    megaDrivePanel.open = true;
  }

  setUserMenuOpen(false);
  renderAppShellRoute();
  renderUserMenu();
  renderLobby();
  renderReactionLobbyHome();
  renderShoppingListItems();
  if (showingLobby) {
    void loadShoppingList();
    void loadInteractionUsers();
  }
  if (!showingLobby && appRoute === "playHome") {
    void loadEutheriumLobby();
    if (hostPermissions.canAwardEutherium) {
      void loadInteractionUsers();
    }
  }
  if (playMode === "eutherdoom" && activeLobbyInstance()?.kind === "eutherdoom") {
    void refreshDoomStatus();
  }
  if (!showingLobby && appRoute === "eutherdoom") {
    void startEutherDoomRenderer();
  } else {
    void stopEutherDoomRenderer();
  }
  if (!showingLobby && appRoute === "eutherduke") {
    void startEutherDukeRenderer();
  } else {
    stopEutherDukeRenderer();
  }
  if (!showingLobby && appRoute === "eutheralert") {
    void startEutherAlertRenderer();
  } else {
    stopEutherAlertRenderer();
  }
  if (!showingLobby && appRoute === "euthercivet") {
    void enterCivetMode();
  } else if (civetMode) {
    leaveCivetMode();
  }
}

function currentPlayModeRoute(): PlayMode | null {
  return isPlayMode(appRoute) ? appRoute : null;
}

function isPlayMode(value: unknown): value is PlayMode {
  return (
    value === "megadrive" ||
    value === "eutherdogs" ||
    value === "euthercivet" ||
    value === "eutheralert" ||
    value === "eutherdoom" ||
    value === "eutherduke"
  );
}

function playModeLabel(mode: PlayMode | null): string {
  switch (mode) {
    case "megadrive":
      return "MegaDrive";
    case "eutherdogs":
      return "EutherDogs";
    case "euthercivet":
      return "EutherCivet";
    case "eutheralert":
      return "EutherAlert";
    case "eutherdoom":
      return "EutherDoom";
    case "eutherduke":
      return "EutherDuke";
    default:
      return "Mode Launcher";
  }
}

function handleAppRouteButton(button: HTMLButtonElement): boolean {
  const route = appRouteFromToken(button.dataset.appRoute);
  if (!route) {
    return false;
  }
  navigateApp(route);
  return true;
}

function handleWorkspaceWindowButton(button: HTMLButtonElement): boolean {
  const target = button.dataset.workspaceWindow;
  if (!isWorkspaceWindow(target)) {
    return false;
  }
  openWorkspaceWindow(target);
  return true;
}

function isWorkspaceWindow(value: unknown): value is WorkspaceWindow {
  return (
    value === "interaction" ||
    value === "shopping" ||
    value === "eutherium" ||
    value === "books" ||
    value === "friends" ||
    value === "spaces" ||
    value === "profile" ||
    value === "settings"
  );
}

function renderAppShellRoute(): void {
  const playMode = currentPlayModeRoute();
  playModeStatus.textContent = playMode ? playModeLabel(playMode) : "Lobby";
  appNavButtons.forEach((button) => {
    const route = appRouteFromToken(button.dataset.appRoute);
    const selected = route === appRoute;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-current", selected ? "page" : "false");
  });
  playModeButtons.forEach((button) => {
    const mode = button.dataset.playMode;
    const selected = mode === playMode;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", selected ? "true" : "false");
  });
}

async function handleReactionLobbyHomeAction(button: HTMLButtonElement): Promise<void> {
  const action = button.dataset.reactionHomeAction ?? "";
  const instanceId = button.dataset.reactionHomeInstance;
  switch (action) {
    case "refresh":
      await refreshLobby();
      return;
    case "start-megadrive":
      await startLobbyInstance("megadrive");
      return;
    case "start-eutheralert":
      await startEutherAlertAsServer();
      return;
    case "start-eutherdoom":
      await startLobbyInstance("eutherdoom");
      return;
    case "open-eutherdogs":
      await activatePlayMode("eutherdogs");
      return;
    case "open-euthercivet":
      await activatePlayMode("euthercivet");
      return;
    case "open-eutherduke":
      await activatePlayMode("eutherduke");
      return;
    case "video-chat":
      openVideoChatPanel();
      return;
    case "chat-focus":
      focusReactionChat();
      return;
    case "eutherium":
      openWorkspaceWindow("eutherium");
      return;
    case "eutherium-refresh":
      await loadEutheriumLobby(true);
      return;
    case "open":
    case "join":
    case "spectate":
    case "claim-p1":
    case "claim-p2":
      if (!instanceId) {
        return;
      }
      await openReactionLobbyInstance(instanceId, action);
      return;
    default:
      return;
  }
}

function openVideoChatPanel(): void {
  if (appRoute === "interactionLobby") {
    navigateApp("playHome");
  }
  videoChatPanel.classList.remove("is-collapsed");
  videoChatToggle.focus({ preventScroll: true });
  videoChatPanel.scrollIntoView({ block: "center", behavior: "smooth" });
  renderVideoChat();
}

function focusReactionChat(): void {
  if (appRoute === "interactionLobby") {
    navigateApp("playHome");
  }
  chatInput.focus({ preventScroll: true });
  chatInput.scrollIntoView({ block: "center", behavior: "smooth" });
}

async function openReactionLobbyInstance(
  instanceId: string,
  action: "open" | "join" | "spectate" | "claim-p1" | "claim-p2",
): Promise<void> {
  const instance = lobbyStatus?.instances.find((candidate) => candidate.id === instanceId);
  if (!instance) {
    await refreshLobby();
    return;
  }
  const kind = lobbyInstanceKind(instance);
  navigateApp(kind);
  if (kind === "eutheralert") {
    await requestEutherAlertFullscreen(true);
  }
  if (dogsMode) {
    leaveDogsMode();
  }
  await selectLobbyInstance(instanceId);
  switch (action) {
    case "join":
      await joinLobbyInstance();
      return;
    case "spectate":
      await spectateActiveLobbyInstance();
      return;
    case "claim-p1":
      await joinLobbyInstance(1);
      return;
    case "claim-p2":
      await joinLobbyInstance(2);
      return;
    case "open":
      return;
  }
}

function workspaceWindowTitleFor(windowName: WorkspaceWindow): string {
  switch (windowName) {
    case "interaction":
      return "Interaction Lobby";
    case "shopping":
      return "Shopping List";
    case "eutherium":
      return "Eutherium";
    case "books":
      return "Audiobooks";
    case "friends":
      return "Friends";
    case "spaces":
      return "Shared Spaces";
    case "profile":
      return "Profile";
    case "settings":
      return "Settings";
  }
}

function openWorkspaceWindow(windowName: WorkspaceWindow): void {
  activeWorkspaceWindow = windowName;
  workspaceWindowLayer.hidden = false;
  document.body.classList.add("workspace-window-open");
  renderWorkspaceWindow();
  renderUserMenu();
  if (windowName === "shopping") {
    void loadShoppingList();
    void loadInteractionUsers();
  } else if (windowName === "eutherium") {
    void loadEutherium();
    if (hostPermissions.canAwardEutherium) {
      void loadInteractionUsers();
    }
  } else if (windowName === "books") {
    void loadEutherBooks();
    void refreshEutherBooksHealth(true);
  } else if (windowName === "interaction") {
    void loadInteractionUsers();
    void refreshActiveSocialChat("open", 0);
    void searchSocialChatUsers();
  } else if (windowName === "friends" || windowName === "spaces") {
    void loadInteractionUsers();
  }
}

function closeWorkspaceWindow(): void {
  if (eutherBooksJobPollTimer !== null) {
    window.clearTimeout(eutherBooksJobPollTimer);
    eutherBooksJobPollTimer = null;
  }
  eutherBooksPrefetchJobs = [];
  clearEutherBooksPrefetchPoll();
  clearEutherBooksHealthPoll();
  activeWorkspaceWindow = null;
  workspaceWindowLayer.hidden = true;
  document.body.classList.remove("workspace-window-open");
  shoppingListPanel.hidden = true;
  workspaceWindowDynamic.hidden = false;
  renderUserMenu();
}

function renderWorkspaceWindow(): void {
  const windowName = activeWorkspaceWindow;
  if (!windowName) {
    return;
  }
  const audioState = windowName === "books" ? captureEutherBooksAudioRenderState() : null;
  const renderToken = windowName === "books" ? ++eutherBooksAudioRenderToken : eutherBooksAudioRenderToken;
  if (windowName === "books") {
    retireDetachedEutherBooksAudio();
  }
  const showingShopping = windowName === "shopping";
  workspaceWindowEyebrow.textContent = "Workspace window";
  workspaceWindowTitle.textContent = workspaceWindowTitleFor(windowName);
  shoppingListPanel.hidden = !showingShopping;
  workspaceWindowDynamic.hidden = showingShopping;
  workspaceWindowLayer.classList.toggle("is-shopping", showingShopping);
  workspaceWindowLayer.classList.toggle("is-books", windowName === "books");
  workspaceWindowLayer.classList.toggle("is-social", !showingShopping);
  workspaceWindowLayer.classList.toggle("is-social-chat", windowName === "interaction");
  if (showingShopping) {
    renderShoppingListItems();
    return;
  }
  workspaceWindowDynamic.innerHTML = workspaceWindowContentMarkup(windowName);
  if (windowName === "books") {
    restoreEutherBooksVoicePickerScroll();
  }
  if (audioState) {
    restoreEutherBooksAudioRenderState(audioState, renderToken);
  }
}

function restoreEutherBooksVoicePickerScroll(): void {
  if (eutherBooksVoicePickerScrollTop <= 0) {
    return;
  }
  window.requestAnimationFrame(() => {
    const picker = workspaceWindowDynamic.querySelector<HTMLDivElement>(".eutherbooks-voice-picker-groups");
    if (!picker) {
      return;
    }
    picker.scrollTop = Math.min(eutherBooksVoicePickerScrollTop, picker.scrollHeight);
  });
}

function workspaceWindowContentMarkup(windowName: WorkspaceWindow): string {
  switch (windowName) {
    case "interaction":
      return interactionDeskWindowMarkup();
    case "friends":
      return friendsWindowMarkup();
    case "spaces":
      return sharedSpacesWindowMarkup();
    case "profile":
      return profileWindowMarkup();
    case "settings":
      return settingsWindowMarkup();
    case "shopping":
      return "";
    case "books":
      return eutherBooksWindowMarkup();
    case "eutherium":
      return eutheriumWindowMarkup();
  }
}

function eutheriumWindowMarkup(): string {
  if (!hostUsername) {
    return `<div class="interaction-panel"><p class="section-label">Eutherium</p><strong>Login required</strong></div>`;
  }
  const data = eutheriumMe;
  if (!data) {
    return `<div class="interaction-panel eutherium-loading"><p class="section-label">Eutherium</p><strong>${escapeHtml(eutheriumStatus)}</strong></div>`;
  }
  return `
    <div class="eutherium-window">
      <section class="eutherium-balance-panel">
        <div>
          <p class="section-label">Eutherium Ledger</p>
          <strong>${formatEutherium(data.balance)} EUX</strong>
          <span>${escapeHtml(eutheriumStatus)}</span>
        </div>
        <button class="mini-action" data-eutherium-refresh type="button">Sync</button>
      </section>
      <section class="eutherium-trophy-panel">
        <div class="section-head">
          <div>
            <p class="section-label">Trophy Room</p>
            <strong>${escapeHtml(displayUserName(data.user))}'s room</strong>
          </div>
          <span>${data.trophyRoom.layout.items.length} placed</span>
        </div>
        ${trophyRoomMarkup(data)}
        ${trophyPreviewMarkup(data)}
        ${trophyControlsMarkup()}
      </section>
      ${hostPermissions.canAwardEutherium ? eutheriumAwardPanelMarkup() : ""}
      <section class="eutherium-shop-panel">
        <div class="section-head">
          <p class="section-label">Shop</p>
          <span>No real money, only glory</span>
        </div>
        <div class="eutherium-shop-grid">
          ${data.items.map((item) => shopItemMarkup(item, data.balance)).join("")}
        </div>
      </section>
      <section class="eutherium-inventory-panel">
        <div class="section-head">
          <p class="section-label">Inventory</p>
          <span>${data.inventory.length} trophies</span>
        </div>
        <div class="eutherium-inventory-grid">
          ${data.inventory.length ? data.inventory.map((entry) => inventoryItemMarkup(entry, data.trophyRoom.layout)).join("") : `<span>No trophies yet</span>`}
        </div>
      </section>
      <section class="eutherium-ledger-panel">
        <div class="section-head">
          <p class="section-label">Recent Ledger</p>
          <span>Traceable</span>
        </div>
        <div class="eutherium-ledger-list">
          ${data.ledger.length ? data.ledger.map(ledgerEntryMarkup).join("") : `<span>No ledger entries yet</span>`}
        </div>
      </section>
    </div>
  `;
}

function eutherBooksWindowMarkup(): string {
  const selectedBook = selectedEutherBook();
  const playbackJob = currentEutherBooksPlaybackJob();
  const audioFiles = playbackJob?.audio_files ?? [];
  const combinedPlayback = eutherBooksUsesCombinedPlayback(playbackJob);
  const webAudioPlayback = eutherBooksUsesWebAudioPlayback(playbackJob);
  const playbackTimeline = eutherBooksPlaybackTimeline(playbackJob, null);
  const audioPath = audioFiles[eutherBooksAudioIndex] ?? null;
  const audioSource = playbackJob && combinedPlayback
    ? eutherBooksJobAudioUrl(playbackJob)
    : audioPath
      ? eutherBooksAudioUrl(audioPath)
      : null;
  const virtualPlayer = eutherBooksVirtualPlayerMarkup(playbackJob, audioSource);
  const progress = eutherBooksJobProgress();
  const processStatus = eutherBooksProcessStatus();
  const backendPulse = eutherBooksBackendPulse();
  const sleepTimerLabel = eutherBooksSleepTimerLabel();
  const canGenerate = Boolean(selectedBook && selectedEutherBookChapters.length && !eutherBooksLoading);
  const bookmark = selectedBook ? eutherBooksBookmarkFor(selectedBook.id) : null;
  const bookmarkLabel = bookmark ? eutherBooksBookmarkLabel(bookmark) : "No bookmark";
  const audioOptions = combinedPlayback || webAudioPlayback
    ? `<option value="0">Full chapter</option>`
    : audioFiles.length
    ? audioFiles
        .map((file, index) => {
          const label = eutherBooksAudioPartLabel(file, index);
          return `<option value="${index}" ${index === eutherBooksAudioIndex ? "selected" : ""}>${escapeHtml(label)}</option>`;
        })
        .join("")
    : `<option value="">No generated audio</option>`;
  const chapterOptions = selectedEutherBookChapters.length
    ? selectedEutherBookChapters
        .map(
          (chapter) =>
            `<option value="${chapter.index}" ${chapter.index === selectedEutherBookChapterIndex ? "selected" : ""}>${escapeHtml(chapter.title)} (${formatCompactNumber(chapter.char_count)} chars)</option>`,
        )
        .join("")
    : `<option value="0">No chapters</option>`;
  const bookOptions = eutherBooks.length
    ? eutherBooks
        .map(
          (book) =>
            `<option value="${escapeHtml(book.id)}" ${book.id === selectedEutherBookId ? "selected" : ""}>${escapeHtml(book.title)} / ${escapeHtml(book.format.toUpperCase())}</option>`,
        )
        .join("")
    : `<option value="">No books</option>`;
  const bookRows = eutherBooks.length
    ? eutherBooks
        .map(
          (book) => `
            <button class="eutherbooks-book-row ${book.id === selectedEutherBookId ? "is-selected" : ""}" data-eutherbooks-book="${escapeHtml(book.id)}" type="button">
              <strong>${escapeHtml(book.title)}</strong>
              <span>${escapeHtml(book.author ?? book.path)} / ${escapeHtml(book.format.toUpperCase())}</span>
            </button>
          `,
        )
        .join("")
    : `<div class="eutherbooks-empty"><strong>No books indexed</strong><span>Drop .epub, .pdf, .txt or .md files in the EutherBooks library directory.</span></div>`;

  return `
    <div class="eutherbooks-window">
      <section class="interaction-panel eutherbooks-library-panel">
        <div class="section-head">
          <div>
            <p class="section-label">EutherBooks</p>
            <strong>Local audiobook shelf</strong>
          </div>
          <div class="eutherbooks-head-actions">
            ${canHostManageLibrary() ? `<button class="mini-action" data-eutherbooks-upload type="button">Upload</button>` : ""}
            <button class="mini-action" data-eutherbooks-refresh type="button">Scan</button>
          </div>
        </div>
        <input data-eutherbooks-upload-input type="file" accept=".txt,.md,.epub,.pdf,text/plain,text/markdown,application/epub+zip,application/pdf" multiple hidden>
        <div class="eutherbooks-status">
          <span>${escapeHtml(eutherBooksStatus)}</span>
          <strong>${escapeHtml(eutherBooksBase)}</strong>
        </div>
        <div class="eutherbooks-book-list">
          ${bookRows}
        </div>
      </section>
      <section class="interaction-panel eutherbooks-player-panel">
        <div class="section-head">
          <div>
            <p class="section-label">Player</p>
            <strong>${escapeHtml(selectedBook?.title ?? "No book selected")}</strong>
          </div>
          <span>${escapeHtml(eutherBooksPlayerHeaderStatus())}</span>
        </div>
        <label class="eutherbooks-book-select">
          <span>Book</span>
          <select data-eutherbooks-book-select ${eutherBooks.length ? "" : "disabled"}>
            ${bookOptions}
          </select>
        </label>
        <div class="eutherbooks-chapter-control">
          <label>
            <span>Chapter</span>
            <select data-eutherbooks-chapter ${selectedEutherBookChaptersLoading || !selectedEutherBookChapters.length ? "disabled" : ""}>
              ${chapterOptions}
            </select>
          </label>
          <button class="primary-action" data-eutherbooks-tts type="button" ${canGenerate && !eutherBooksTtsSubmitting ? "" : "disabled"}>Generate speech</button>
        </div>
        <details class="eutherbooks-voice-control" data-eutherbooks-voice-settings ${eutherBooksSettingsOpenAttr()}>
          <summary>Voice and model</summary>
          <label>
            <span>Model</span>
            <select data-eutherbooks-model>
              ${eutherBooksModelOptions()}
            </select>
          </label>
          ${eutherBooksModelReadyMarkup()}
          ${eutherBooksVoicePickerMarkup()}
          ${eutherBooksCustomVoiceControl()}
          ${eutherBooksOwnVoiceControl()}
          <div class="eutherbooks-option-grid">
            ${eutherBooksTtsOptionControls()}
          </div>
        </details>
        <div class="eutherbooks-now-playing">
          <span>${escapeHtml(eutherBooksPlaybackLabel())}</span>
          <div class="eutherbooks-backend-pulse ${eutherBooksJob?.status === "running" || eutherBooksJob?.status === "queued" ? "is-active" : ""}">
            <strong>${escapeHtml(backendPulse.title)}</strong>
            <small>${escapeHtml(backendPulse.detail)}</small>
          </div>
          <div class="eutherbooks-smart-controls">
            <button data-eutherbooks-auto-advance class="${eutherBooksAutoAdvance ? "is-selected" : ""}" type="button">Auto-play</button>
            <button data-eutherbooks-auto-generate class="${eutherBooksAutoGenerateNext ? "is-selected" : ""}" type="button">Auto-generate next</button>
          </div>
          <label class="eutherbooks-sleep-timer ${eutherBooksSleepTimerMode !== "off" ? "is-active" : ""}">
            <span>Sleep timer</span>
            <select data-eutherbooks-sleep-timer>
              <option value="off" ${eutherBooksSleepTimerMode === "off" ? "selected" : ""}>Off</option>
              <option value="5" ${eutherBooksSleepTimerMode === "5" ? "selected" : ""}>5 min</option>
              <option value="10" ${eutherBooksSleepTimerMode === "10" ? "selected" : ""}>10 min</option>
              <option value="15" ${eutherBooksSleepTimerMode === "15" ? "selected" : ""}>15 min</option>
              <option value="30" ${eutherBooksSleepTimerMode === "30" ? "selected" : ""}>30 min</option>
              <option value="45" ${eutherBooksSleepTimerMode === "45" ? "selected" : ""}>45 min</option>
              <option value="60" ${eutherBooksSleepTimerMode === "60" ? "selected" : ""}>60 min</option>
              <option value="chapter" ${eutherBooksSleepTimerMode === "chapter" ? "selected" : ""}>End of chapter</option>
            </select>
            <small>${escapeHtml(sleepTimerLabel)}</small>
          </label>
          <label class="eutherbooks-audio-select ${webAudioPlayback ? "is-virtual" : ""}">
            <span>${webAudioPlayback ? "Playback scope" : "Generated part"}</span>
            <select data-eutherbooks-audio-select ${audioFiles.length && !combinedPlayback && !webAudioPlayback ? "" : "disabled"}>
              ${audioOptions}
            </select>
          </label>
          ${virtualPlayer}
          ${eutherBooksPlaybackBufferMarkup(playbackTimeline)}
          ${eutherBooksPlaybackDebugMarkup(playbackTimeline)}
        </div>
        <div class="eutherbooks-bookmark-panel">
          <span>${escapeHtml(bookmarkLabel)}</span>
          <div>
            <button data-eutherbooks-resume type="button" ${bookmark ? "" : "disabled"}>Resume</button>
            <button data-eutherbooks-bookmark type="button" ${audioPath ? "" : "disabled"}>Bookmark</button>
          </div>
        </div>
        <div class="eutherbooks-generation-progress" aria-label="${escapeHtml(progress.label)}">
          <div>
            <span>${escapeHtml(progress.label)}</span>
            <strong>${progress.percent}%</strong>
          </div>
          <progress max="100" value="${progress.percent}"></progress>
          ${processStatus ? `<small>${escapeHtml(processStatus)}</small>` : ""}
        </div>
        <div class="eutherbooks-player-actions">
          <button data-eutherbooks-prev-audio type="button" ${audioFiles.length ? "" : "disabled"}>${webAudioPlayback ? "-15s" : "Prev"}</button>
          <button data-eutherbooks-next-audio type="button" ${audioFiles.length ? "" : "disabled"}>${webAudioPlayback ? "+15s" : "Next"}</button>
        </div>
        <div class="eutherbooks-job-note">
          ${escapeHtml(eutherBooksVisibleJobNote())}
        </div>
      </section>
    </div>
  `;
}

function eutherBooksVoicePickerMarkup(): string {
  const selected = eutherBooksSelectedVoice();
  const selectedLabel = selected?.label ?? selectedEutherBooksVoice;
  const groups = eutherBooksVoiceGroups().filter(([, groupVoices]) => groupVoices.length > 0);
  return `
    <div class="eutherbooks-voice-picker">
      <div class="eutherbooks-voice-picker-head">
        <span>Voice</span>
        <strong>${escapeHtml(selectedLabel)}</strong>
      </div>
      <div class="eutherbooks-voice-picker-groups" role="listbox" aria-label="Voice">
        ${groups.map(([label, groupVoices]) => `
          <section class="eutherbooks-voice-picker-group">
            <span>${escapeHtml(label)}</span>
            <div>
              ${groupVoices.map(eutherBooksVoiceChoiceButton).join("")}
            </div>
          </section>
        `).join("")}
      </div>
    </div>
  `;
}

function eutherBooksVoiceGroups(): Array<[string, EutherBooksVoice[]]> {
  const voices = eutherBooksVoices.length
    ? eutherBooksVoices
    : [
        { id: "sv-female-warm", label: "Warm female narrator", language: "sv", backend: "eutherlink", path: "", model_backend: "voxcpm2", default_length_scale: 1.15, default_seed: 774928057 },
        { id: "sv-male-warm", label: "Warm male narrator", language: "sv", backend: "eutherlink", path: "", model_backend: "voxcpm2", default_length_scale: 1.15, default_seed: 757444653 },
        { id: "en-female-warm", label: "English warm female narrator", language: "en", backend: "eutherlink", path: "", model_backend: "voxcpm2", default_length_scale: 1.15, default_seed: 2073739982 },
        { id: "en-male-warm", label: "English warm male narrator", language: "en", backend: "eutherlink", path: "", model_backend: "voxcpm2", default_length_scale: 1.15, default_seed: 550498084 },
        { id: "own-sv", label: "Your own voice SV", language: "sv", backend: "eutherlink", path: "user:own-sv", model_backend: "voxcpm2" },
        { id: "own-en", label: "Your own voice EN", language: "en", backend: "eutherlink", path: "user:own-en", model_backend: "voxcpm2" },
        { id: "dots-mf-own-sv", label: "Dots MF own voice SV", language: "sv", backend: "eutherlink", path: "user:own-sv", model_backend: "dots.tts-mf" },
        { id: "dots-mf-own-en", label: "Dots MF own voice EN", language: "en", backend: "eutherlink", path: "user:own-en", model_backend: "dots.tts-mf" },
        { id: "dots-soar-own-sv", label: "Dots SOAR own voice SV", language: "sv", backend: "eutherlink", path: "user:own-sv", model_backend: "dots.tts-soar" },
        { id: "dots-soar-own-en", label: "Dots SOAR own voice EN", language: "en", backend: "eutherlink", path: "user:own-en", model_backend: "dots.tts-soar" },
        { id: "custom", label: "Custom voice prompt", language: "sv", backend: "eutherlink", path: "", model_backend: "voxcpm2" },
      ];
  const activeModel = selectedEutherBooksModelBackend;
  const modelVoices = voices.filter((voice) => (eutherBooksVoiceModelBackend(voice) ?? "voxcpm2") === activeModel);
  const groups: Array<[string, EutherBooksVoice[]]> =
    activeModel === "voxcpm2"
      ? [
          ["Svenska röster", modelVoices.filter((voice) => voice.language.toLowerCase().startsWith("sv") && !["custom", "own-sv", "own-en"].includes(voice.id))],
          ["English voices", modelVoices.filter((voice) => voice.language.toLowerCase().startsWith("en") && !["own-sv", "own-en"].includes(voice.id))],
          ["Your own voice", modelVoices.filter((voice) => voice.id === "own-sv" || voice.id === "own-en")],
          ["Egen röst", modelVoices.filter((voice) => voice.id === "custom")],
        ]
      : [
          ["Svenska röster", modelVoices.filter((voice) => voice.language.toLowerCase().startsWith("sv") && !eutherBooksVoiceIsOwn(voice.id))],
          ["English voices", modelVoices.filter((voice) => voice.language.toLowerCase().startsWith("en") && !eutherBooksVoiceIsOwn(voice.id))],
          ["Your own voice", modelVoices.filter((voice) => eutherBooksVoiceIsOwn(voice.id))],
        ];
  return groups;
}

function eutherBooksModelOptions(): string {
  const active = eutherBooksEffectiveModelBackend();
  return [
    `<option value="voxcpm2" ${active === "voxcpm2" ? "selected" : ""}>VoxCPM2</option>`,
    `<option value="dots.tts-mf" ${active === "dots.tts-mf" ? "selected" : ""}>Dots MF fast</option>`,
    `<option value="dots.tts-soar" ${active === "dots.tts-soar" ? "selected" : ""}>Dots SOAR quality</option>`,
  ].join("");
}

function eutherBooksModelReadyMarkup(): string {
  const active = eutherBooksEffectiveModelBackend();
  if (!eutherBooksIsDotsModel(active)) {
    return `
      <div class="eutherbooks-model-ready">
        <span>Model</span>
        <strong>VoxCPM2 selected</strong>
      </div>
    `;
  }
  const status = eutherBooksHealth?.dots_tts?.status ?? (eutherBooksHealthLoading ? "checking" : "unknown");
  const loadedModel = eutherBooksLoadedDotsModelBackend();
  const selectedModelLoaded = loadedModel === null || loadedModel === active;
  const ready = selectedModelLoaded && (eutherBooksHealth?.dots_tts?.model_loaded === true || status === "ready");
  const offline = status === "offline" || status === "unknown";
  const label = ready ? "Model ready" : offline ? "Model offline" : "Model warming";
  const detail = ready
    ? `${active === "dots.tts-mf" ? "Dots MF" : "Dots SOAR"} warm${eutherBooksHealth?.dots_tts?.precision ? ` / ${eutherBooksHealth.dots_tts.precision}` : ""}`
    : offline
      ? `${active === "dots.tts-mf" ? "Dots MF" : "Dots SOAR"} not reachable`
      : `${active === "dots.tts-mf" ? "Dots MF" : "Dots SOAR"} loading`;
  return `
    <div class="eutherbooks-model-ready ${ready ? "is-ready" : offline ? "is-offline" : "is-warming"}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(detail)}</strong>
    </div>
  `;
}

function eutherBooksLoadedDotsModelBackend(): EutherBooksModelBackend | null {
  const loadedModel = eutherBooksHealth?.dots_tts?.loaded_model?.toLowerCase() ?? "";
  if (!loadedModel) {
    return null;
  }
  if (loadedModel.includes("dots.tts-mf")) {
    return "dots.tts-mf";
  }
  if (loadedModel.includes("dots.tts-soar")) {
    return "dots.tts-soar";
  }
  return null;
}

function normalizeEutherBooksModelBackend(value: string): EutherBooksModelBackend {
  const normalized = value.trim().toLowerCase();
  return normalized === "dots.tts-mf" || normalized === "dots.tts-soar" ? normalized : "voxcpm2";
}

function eutherBooksIsDotsModel(value: string): boolean {
  return value === "dots.tts-mf" || value === "dots.tts-soar";
}

function eutherBooksVoiceModelBackend(voice: EutherBooksVoice | undefined): EutherBooksModelBackend | undefined {
  if (!voice?.model_backend) {
    return undefined;
  }
  return normalizeEutherBooksModelBackend(voice.model_backend);
}

function eutherBooksEffectiveModelBackend(): EutherBooksModelBackend {
  return selectedEutherBooksModelBackend;
}

function eutherBooksBaseVoiceId(voiceId: string): string {
  const normalized = voiceId.trim();
  const lower = normalized.toLowerCase();
  if (lower.startsWith("dots-mf-")) {
    return normalized.slice("dots-mf-".length);
  }
  if (lower.startsWith("dots-soar-")) {
    return normalized.slice("dots-soar-".length);
  }
  return normalized;
}

function eutherBooksVoiceIdForModelBackend(baseVoiceId: string, modelBackend: EutherBooksModelBackend, language: string): string {
  const ownVoiceId = language === "en" ? "own-en" : "own-sv";
  const ownDotsVoiceId =
    modelBackend === "dots.tts-mf"
      ? language === "en" ? "dots-mf-own-en" : "dots-mf-own-sv"
      : language === "en" ? "dots-soar-own-en" : "dots-soar-own-sv";
  const base = baseVoiceId === "own-en" || baseVoiceId === "own-sv" ? ownVoiceId : baseVoiceId;
  const preferred =
    modelBackend === "dots.tts-mf"
      ? `dots-mf-${base}`
      : modelBackend === "dots.tts-soar"
        ? `dots-soar-${base}`
        : base;
  const available = (id: string) => eutherBooksVoices.some((voice) => voice.id === id);
  if (!eutherBooksVoices.length || available(preferred)) {
    return preferred;
  }
  if (modelBackend !== "voxcpm2" && available(ownDotsVoiceId)) {
    return ownDotsVoiceId;
  }
  if (modelBackend === "voxcpm2" && available(base)) {
    return base;
  }
  return modelBackend === "voxcpm2" ? ownVoiceId : ownDotsVoiceId;
}

function persistEutherBooksModelBackend(): void {
  localStorage.setItem("eutherbooks-model", selectedEutherBooksModelBackend);
}

function eutherBooksIsOwnVoiceSelection(): boolean {
  return eutherBooksVoiceIsOwn(selectedEutherBooksVoice);
}

function eutherBooksVoiceIsOwn(voiceId: string): boolean {
  return voiceId === "own-sv" || voiceId === "own-en" || voiceId === "dots-mf-own-sv" || voiceId === "dots-mf-own-en" || voiceId === "dots-soar-own-sv" || voiceId === "dots-soar-own-en";
}

function selectEutherBooksVoiceForModelBackend(): void {
  const language = eutherBooksRequestLanguage();
  const baseVoiceId = eutherBooksBaseVoiceId(selectedEutherBooksVoice);
  selectedEutherBooksVoice = eutherBooksVoiceIdForModelBackend(baseVoiceId, selectedEutherBooksModelBackend, language);
  if (eutherBooksIsOwnVoiceSelection() || selectedEutherBooksVoice === "custom") {
    eutherBooksVoiceSettingsOpen = true;
  }
}

function eutherBooksVoiceChoiceButton(voice: EutherBooksVoice): string {
  const selected = voice.id === selectedEutherBooksVoice;
  const language = voice.language.toLowerCase().startsWith("en") ? "EN" : "SV";
  return `
    <button
      class="eutherbooks-voice-choice ${selected ? "is-selected" : ""}"
      data-eutherbooks-voice-choice="${escapeHtml(voice.id)}"
      type="button"
      role="option"
      aria-selected="${selected ? "true" : "false"}"
    >
      <strong>${escapeHtml(voice.label)}</strong>
      <span>${escapeHtml(language)}${eutherBooksVoiceIsOwn(voice.id) ? " own voice" : ""}</span>
    </button>
  `;
}

function eutherBooksSelectedVoice(): EutherBooksVoice | undefined {
  return eutherBooksVoices.find((voice) => voice.id === selectedEutherBooksVoice);
}

function eutherBooksRequestLanguage(): string {
  const language = eutherBooksSelectedVoice()?.language?.toLowerCase() ?? (selectedEutherBooksVoice.startsWith("en-") ? "en" : "sv");
  return language.startsWith("en") ? "en" : "sv";
}

function applyEutherBooksSelectedVoiceDefaults(): void {
  const voice = eutherBooksSelectedVoice();
  if (!voice || selectedEutherBooksVoice === "own-sv" || selectedEutherBooksVoice === "own-en" || selectedEutherBooksVoice === "custom") {
    return;
  }
  if (typeof voice.default_length_scale === "number" && Number.isFinite(voice.default_length_scale)) {
    eutherBooksLengthScale = clampEutherBooksOption("length_scale", voice.default_length_scale);
    localStorage.setItem("eutherbooks-length_scale", String(eutherBooksLengthScale));
  }
  if (typeof voice.default_seed === "number" && Number.isFinite(voice.default_seed)) {
    eutherBooksSeed = clampEutherBooksOption("seed", voice.default_seed);
    localStorage.setItem("eutherbooks-seed", String(eutherBooksSeed));
  }
}

function eutherBooksSelectedVoiceBackend(): string {
  return eutherBooksSelectedVoice()?.backend ?? "eutherlink";
}

function eutherBooksUsesEutherLinkVoice(): boolean {
  return eutherBooksSelectedVoiceBackend() === "eutherlink" || selectedEutherBooksVoice === "custom";
}

function eutherBooksSettingsOpenAttr(): string {
  return eutherBooksVoiceSettingsOpen || !window.matchMedia("(max-width: 720px)").matches ? "open" : "";
}

function eutherBooksTtsOptionControls(): string {
  if (eutherBooksUsesEutherLinkVoice()) {
    if (eutherBooksIsDotsModel(eutherBooksEffectiveModelBackend())) {
      return [
        eutherBooksOptionSlider("Speed", "length_scale", eutherBooksLengthScale, 0.75, 1.35, 0.05, "Lower is faster"),
        eutherBooksOptionSlider("Guidance scale", "dots_guidance_scale", eutherBooksDotsGuidanceScale, 0, 5, 0.05, "Dots classifier-free guidance"),
        eutherBooksOptionSlider("Speaker scale", "dots_speaker_scale", eutherBooksDotsSpeakerScale, 0, 5, 0.05, "Reference voice strength"),
        eutherBooksOptionSlider("Steps", "dots_num_steps", eutherBooksDotsNumSteps, 1, 50, 1, "Dots diffusion steps"),
        eutherBooksOptionSlider("Chunk size", "max_chunk_chars", eutherBooksMaxChunkChars, 120, 1500, 20, "Longer chunks keep more context"),
        eutherBooksSeedControl(),
      ].join("");
    }
    return [
      eutherBooksOptionSlider("Speed", "length_scale", eutherBooksLengthScale, 0.75, 1.35, 0.05, "Lower is faster"),
      eutherBooksOptionSlider("Guidance", "cfg_value", eutherBooksCfgValue, 1, 3, 0.1, "Speaker consistency and prompt adherence"),
      eutherBooksOptionSlider("Steps", "inference_timesteps", eutherBooksInferenceTimesteps, 10, 50, 1, "Higher costs more time"),
      eutherBooksOptionSlider("Chunk size", "max_chunk_chars", eutherBooksMaxChunkChars, 120, 1500, 20, "Longer chunks keep more context"),
      eutherBooksSeedControl(),
    ].join("");
  }
  return [
    eutherBooksOptionSlider("Speed", "length_scale", eutherBooksLengthScale, 0.75, 1.35, 0.05, "Lower is faster"),
    eutherBooksOptionSlider("Variation", "noise_scale", eutherBooksNoiseScale, 0.2, 1, 0.05, "Higher is looser"),
    eutherBooksOptionSlider("Phonemes", "noise_w", eutherBooksNoiseW, 0.2, 1.2, 0.05, "Pronunciation variation"),
    eutherBooksOptionSlider("Silence", "sentence_silence", eutherBooksSentenceSilence, 0, 0.8, 0.05, "Pause between sentences"),
  ].join("");
}

function eutherBooksCustomVoiceControl(): string {
  if (selectedEutherBooksVoice !== "custom") {
    return "";
  }
  return `
    <label class="eutherbooks-custom-voice">
      <span>Custom voice</span>
      <input data-eutherbooks-custom-voice type="text" value="${escapeHtml(eutherBooksCustomVoicePrompt)}" maxlength="500">
    </label>
  `;
}

function eutherBooksRequestVoice(): string {
  if (selectedEutherBooksVoice === "custom") {
    return eutherBooksCustomVoicePrompt.trim() || "custom";
  }
  return selectedEutherBooksVoice;
}

function eutherBooksOwnVoiceLanguage(): "sv" | "en" {
  return selectedEutherBooksVoice === "own-en" || selectedEutherBooksVoice === "dots-mf-own-en" || selectedEutherBooksVoice === "dots-soar-own-en" ? "en" : "sv";
}

function eutherBooksOwnVoicePath(): string {
  return eutherBooksOwnVoiceLanguage() === "en" ? eutherBooksOwnVoiceEnPath : eutherBooksOwnVoiceSvPath;
}

function eutherBooksOwnVoicePrompt(): string {
  return eutherBooksOwnVoiceLanguage() === "en" ? eutherBooksOwnVoiceEnPrompt : eutherBooksOwnVoiceSvPrompt;
}

function eutherBooksRequestVoiceReferencePath(): string {
  return eutherBooksIsOwnVoiceSelection() ? eutherBooksOwnVoicePath() : "";
}

function eutherBooksRequestVoicePromptText(): string {
  return eutherBooksIsOwnVoiceSelection() ? eutherBooksOwnVoicePrompt() : "";
}

function normalizeEutherBooksOwnVoicePrompt(language: "sv" | "en", value: string | null | undefined): string {
  const fallback = language === "en" ? eutherBooksOwnVoiceEnPromptDefault : eutherBooksOwnVoiceSvPromptDefault;
  const legacy = language === "en" ? eutherBooksOwnVoiceEnPromptLegacy : eutherBooksOwnVoiceSvPromptLegacy;
  const trimmed = (value ?? "").trim();
  if (!trimmed || trimmed === legacy) {
    return fallback;
  }
  return trimmed.slice(0, 500);
}

function eutherBooksOwnVoiceLocked(): boolean {
  return eutherBooksOwnVoiceLanguage() === "en" ? eutherBooksOwnVoiceEnLocked : eutherBooksOwnVoiceSvLocked;
}

function eutherBooksOwnVoiceControl(): string {
  if (!eutherBooksIsOwnVoiceSelection()) {
    return "";
  }
  const recording = eutherBooksVoiceRecorder?.state === "recording";
  const hasPreview = Boolean(eutherBooksVoiceSampleUrl);
  const hasSaved = eutherBooksOwnVoiceLocked() && eutherBooksOwnVoicePath();
  return `
    <div class="eutherbooks-own-voice">
      <strong>${eutherBooksOwnVoiceLanguage() === "en" ? "Your own voice EN" : "Your own voice SV"}</strong>
      <p>${escapeHtml(hasSaved ? "Voice sample locked" : "No voice sample saved")}</p>
      <div class="eutherbooks-own-voice-actions">
        <button data-eutherbooks-record-voice type="button">${hasSaved ? "Replace sample" : "Record sample"}</button>
        <button data-eutherbooks-pick-voice type="button" ${recording ? "disabled" : ""}>Choose audio</button>
        <button data-eutherbooks-save-voice type="button" ${hasPreview && !recording ? "" : "disabled"}>Lock voice sample</button>
        <button data-eutherbooks-replay-voice type="button" ${hasSaved && !recording ? "" : "disabled"}>Replay WAV</button>
        <input data-eutherbooks-voice-sample-input type="file" accept="audio/*" capture="microphone" hidden>
      </div>
      ${hasPreview ? `<audio controls src="${escapeHtml(eutherBooksVoiceSampleUrl)}"></audio>` : ""}
      <small>${escapeHtml(eutherBooksVoiceSampleStatus || "Read the prompt exactly when recording a new sample")}</small>
      ${eutherBooksVoiceSampleDialog()}
    </div>
  `;
}

function eutherBooksVoiceSampleDialog(): string {
  if (!eutherBooksVoiceSampleDialogOpen) {
    return "";
  }
  const recording = eutherBooksVoiceRecorder?.state === "recording";
  const hasPreview = Boolean(eutherBooksVoiceSampleUrl);
  return `
    <div class="eutherbooks-voice-dialog" role="dialog" aria-modal="true" aria-labelledby="eutherbooks-voice-dialog-title">
      <div class="eutherbooks-voice-dialog-panel">
        <div class="eutherbooks-voice-dialog-head">
          <h2 id="eutherbooks-voice-dialog-title">Press record when ready to read</h2>
          <button data-eutherbooks-voice-dialog-close type="button" aria-label="Close">Close</button>
        </div>
        <p class="eutherbooks-voice-read-text">${escapeHtml(eutherBooksOwnVoicePrompt())}</p>
        <div class="eutherbooks-voice-dialog-actions">
          <button data-eutherbooks-dialog-record-voice type="button" ${recording ? "disabled" : ""}>Record</button>
          <button data-eutherbooks-stop-voice type="button" ${recording ? "" : "disabled"}>Stop</button>
          <button data-eutherbooks-pick-voice type="button" ${recording ? "disabled" : ""}>Choose audio</button>
          <button data-eutherbooks-save-voice type="button" ${hasPreview && !recording ? "" : "disabled"}>Lock voice sample</button>
          <button data-eutherbooks-replay-voice type="button" ${eutherBooksOwnVoiceLocked() && !recording ? "" : "disabled"}>Replay WAV</button>
        </div>
        ${hasPreview ? `<audio controls src="${escapeHtml(eutherBooksVoiceSampleUrl)}"></audio>` : ""}
        <small>${escapeHtml(eutherBooksVoiceSampleStatus || "Keep the phone close and read the text once in your normal voice")}</small>
      </div>
    </div>
  `;
}

function applyEutherBooksOwnVoicePreferences(preferences: UserPreferences): void {
  if (typeof preferences.eutherbooksOwnVoiceSvPath === "string") {
    eutherBooksOwnVoiceSvPath = preferences.eutherbooksOwnVoiceSvPath;
    localStorage.setItem("eutherbooks-own-sv-path", eutherBooksOwnVoiceSvPath);
  }
  if (typeof preferences.eutherbooksOwnVoiceSvPrompt === "string") {
    eutherBooksOwnVoiceSvPrompt = normalizeEutherBooksOwnVoicePrompt("sv", preferences.eutherbooksOwnVoiceSvPrompt);
    localStorage.setItem("eutherbooks-own-sv-prompt", eutherBooksOwnVoiceSvPrompt);
  }
  if (typeof preferences.eutherbooksOwnVoiceSvLocked === "boolean") {
    eutherBooksOwnVoiceSvLocked = preferences.eutherbooksOwnVoiceSvLocked;
    localStorage.setItem("eutherbooks-own-sv-locked", String(eutherBooksOwnVoiceSvLocked));
  }
  if (typeof preferences.eutherbooksOwnVoiceEnPath === "string") {
    eutherBooksOwnVoiceEnPath = preferences.eutherbooksOwnVoiceEnPath;
    localStorage.setItem("eutherbooks-own-en-path", eutherBooksOwnVoiceEnPath);
  }
  if (typeof preferences.eutherbooksOwnVoiceEnPrompt === "string") {
    eutherBooksOwnVoiceEnPrompt = normalizeEutherBooksOwnVoicePrompt("en", preferences.eutherbooksOwnVoiceEnPrompt);
    localStorage.setItem("eutherbooks-own-en-prompt", eutherBooksOwnVoiceEnPrompt);
  }
  if (typeof preferences.eutherbooksOwnVoiceEnLocked === "boolean") {
    eutherBooksOwnVoiceEnLocked = preferences.eutherbooksOwnVoiceEnLocked;
    localStorage.setItem("eutherbooks-own-en-locked", String(eutherBooksOwnVoiceEnLocked));
  }
}

async function startEutherBooksVoiceRecording(): Promise<void> {
  if (eutherBooksVoiceRecorder?.state === "recording") {
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    eutherBooksVoiceSampleStatus = "Use Choose audio to record or select a voice sample";
    renderBooksWindowIfActive();
    openEutherBooksVoiceSamplePicker();
    return;
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    eutherBooksVoiceSampleStatus = error instanceof Error ? error.message : "Could not start recording";
    renderBooksWindowIfActive();
    return;
  }
  eutherBooksVoiceRecordChunks = [];
  eutherBooksVoiceRecordCancelled = false;
  eutherBooksVoiceSampleBlob = null;
  if (eutherBooksVoiceSampleUrl) {
    URL.revokeObjectURL(eutherBooksVoiceSampleUrl);
    eutherBooksVoiceSampleUrl = "";
  }
  const recorder = new MediaRecorder(stream);
  eutherBooksVoiceRecorder = recorder;
  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) {
      eutherBooksVoiceRecordChunks.push(event.data);
    }
  });
  recorder.addEventListener("stop", () => {
    stream.getTracks().forEach((track) => track.stop());
    if (eutherBooksVoiceRecordCancelled) {
      eutherBooksVoiceRecordCancelled = false;
      eutherBooksVoiceRecordChunks = [];
      eutherBooksVoiceSampleStatus = "Recording cancelled";
      eutherBooksVoiceRecorder = null;
      renderBooksWindowIfActive();
      return;
    }
    const type = recorder.mimeType || "audio/webm";
    eutherBooksVoiceSampleBlob = new Blob(eutherBooksVoiceRecordChunks, { type });
    eutherBooksVoiceSampleUrl = URL.createObjectURL(eutherBooksVoiceSampleBlob);
    eutherBooksVoiceSampleStatus = "Preview the sample, then lock it to save";
    eutherBooksVoiceRecorder = null;
    renderBooksWindowIfActive();
  });
  recorder.start();
  eutherBooksVoiceSampleDialogOpen = true;
  eutherBooksVoiceSampleStatus = "Recording voice sample";
  renderBooksWindowIfActive();
}

function openEutherBooksVoiceSampleDialog(): void {
  eutherBooksVoiceSettingsOpen = true;
  eutherBooksVoiceSampleDialogOpen = true;
  renderBooksWindowIfActive();
}

function closeEutherBooksVoiceSampleDialog(): void {
  if (eutherBooksVoiceRecorder?.state === "recording") {
    eutherBooksVoiceRecordCancelled = true;
    eutherBooksVoiceRecorder.stop();
  }
  eutherBooksVoiceSampleDialogOpen = false;
  renderBooksWindowIfActive();
}

function stopEutherBooksVoiceRecording(): void {
  if (eutherBooksVoiceRecorder?.state === "recording") {
    eutherBooksVoiceRecorder.stop();
  }
}

async function replayEutherBooksLockedVoiceSample(): Promise<void> {
  if (!eutherBooksOwnVoiceLocked() || !eutherBooksOwnVoicePath()) {
    eutherBooksVoiceSampleStatus = "No locked server WAV to replay";
    renderBooksWindowIfActive();
    return;
  }
  const url = `/api/user/eutherbooks/voice-sample.wav?voice=${encodeURIComponent(selectedEutherBooksVoice)}&t=${Date.now()}`;
  try {
    eutherBooksVoiceSampleStatus = "Replaying locked WAV from server";
    renderBooksWindowIfActive();
    const audio = new Audio(url);
    await audio.play();
  } catch (error) {
    eutherBooksVoiceSampleStatus = error instanceof Error ? error.message : "Could not replay locked WAV";
    renderBooksWindowIfActive();
  }
}

async function saveEutherBooksOwnVoiceSample(): Promise<void> {
  if (!eutherBooksVoiceSampleBlob) {
    return;
  }
  await saveEutherBooksOwnVoiceSampleBlob(eutherBooksVoiceSampleBlob);
}

async function saveEutherBooksOwnVoiceSampleBlob(sampleBlob: Blob): Promise<void> {
  eutherBooksVoiceSampleStatus = "Saving voice sample 0%";
  renderBooksWindowIfActive();
  try {
    const language = eutherBooksOwnVoiceLanguage();
    const dataBase64 = await blobToBase64(sampleBlob, (percent) => {
      eutherBooksVoiceSampleStatus = `Saving voice sample ${Math.min(90, Math.max(1, percent))}%`;
      renderBooksWindowIfActive();
    });
    eutherBooksVoiceSampleStatus = "Upload complete. Converting voice sample on server 95%";
    renderBooksWindowIfActive();
    const preferences = await bridgeJson<UserPreferences>("/api/user/eutherbooks/voice-sample", {
      method: "POST",
      body: JSON.stringify({
        voiceId: selectedEutherBooksVoice,
        language,
        promptText: eutherBooksOwnVoicePrompt(),
        contentType: sampleBlob.type || "application/octet-stream",
        fileName: sampleBlob instanceof File ? sampleBlob.name : "voice-sample.webm",
        dataBase64,
      }),
    });
    applyEutherBooksOwnVoicePreferences(preferences);
    eutherBooksVoiceSampleStatus = "Voice sample locked 100%";
    eutherBooksVoiceSampleBlob = null;
    if (eutherBooksVoiceSampleUrl) {
      URL.revokeObjectURL(eutherBooksVoiceSampleUrl);
      eutherBooksVoiceSampleUrl = "";
    }
    eutherBooksVoiceSampleDialogOpen = false;
    resetEutherBooksSelectionAudio();
  } catch (error) {
    eutherBooksVoiceSampleStatus = error instanceof Error ? error.message : "Could not save voice sample";
  }
  renderBooksWindowIfActive();
}

function openEutherBooksVoiceSamplePicker(): void {
  eutherBooksVoiceSettingsOpen = true;
  eutherBooksVoiceSampleDialogOpen = true;
  const input = workspaceWindowDynamic.querySelector<HTMLInputElement>("[data-eutherbooks-voice-sample-input]");
  input?.click();
}

function useEutherBooksVoiceSampleFile(file: File): void {
  if (!file.type.startsWith("audio/") && file.type !== "application/octet-stream") {
    eutherBooksVoiceSampleStatus = "Choose an audio file for the voice sample";
    renderBooksWindowIfActive();
    return;
  }
  eutherBooksVoiceSampleBlob = file;
  if (eutherBooksVoiceSampleUrl) {
    URL.revokeObjectURL(eutherBooksVoiceSampleUrl);
  }
  eutherBooksVoiceSampleUrl = URL.createObjectURL(file);
  eutherBooksVoiceSampleDialogOpen = true;
  eutherBooksVoiceSampleStatus = "Preview the sample, then lock it to save";
  renderBooksWindowIfActive();
}

function blobToBase64(blob: Blob, onProgress?: (percent: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("progress", (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress?.(Math.round((event.loaded / event.total) * 90));
      }
    });
    reader.addEventListener("load", () => {
      onProgress?.(90);
      const result = String(reader.result ?? "");
      resolve(result.includes(",") ? result.slice(result.indexOf(",") + 1) : result);
    });
    reader.addEventListener("error", () => reject(reader.error ?? new Error("failed to read voice sample")));
    reader.readAsDataURL(blob);
  });
}

function setEutherBooksCustomVoicePrompt(value: string): void {
  eutherBooksCustomVoicePrompt = value.trim().slice(0, 500);
  localStorage.setItem("eutherbooks-custom-voice", eutherBooksCustomVoicePrompt);
  resetEutherBooksSelectionAudio();
  scheduleUserPreferencesSave();
  renderBooksWindowIfActive();
}

function resetEutherBooksSelectionAudio(): void {
  stopEutherBooksWebAudioPlayback(false);
  eutherBooksJob = null;
  eutherBooksPlayableFallbackJob = null;
  eutherBooksAudioIndex = 0;
  eutherBooksPendingAutoplayJobId = null;
  eutherBooksBufferedAutoplayJobId = null;
  eutherBooksPrefetchJobs = [];
  clearEutherBooksPrefetchPoll();
}

function eutherBooksOptionSlider(
  label: string,
  key: string,
  value: number,
  min: number,
  max: number,
  step: number,
  hint: string,
): string {
  return `
    <label>
      <span>${escapeHtml(label)} <strong>${formatEutherBooksOptionValue(value)}</strong></span>
      <input data-eutherbooks-option="${escapeHtml(key)}" type="range" min="${min}" max="${max}" step="${step}" value="${value}">
      <small>${escapeHtml(hint)}</small>
    </label>
  `;
}

function eutherBooksSeedControl(): string {
  return `
    <label>
      <span>Seed <strong>${formatEutherBooksOptionValue(eutherBooksSeed)}</strong></span>
      <input data-eutherbooks-option="seed" type="number" min="0" max="2147483647" step="1" value="${eutherBooksSeed}">
      <small>0 uses sample default; same seed repeats cloned-voice sampling</small>
    </label>
  `;
}

function formatEutherBooksOptionValue(value: number): string {
  return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function eutherBooksPlayerHeaderStatus(): string {
  if (eutherBooksJob?.progress_label) {
    return eutherBooksJob.progress_label;
  }
  if (eutherBooksJob?.status) {
    return eutherBooksJob.status;
  }
  if (eutherBooksTtsSubmitting) {
    return "starting";
  }
  if (["Generating speech", "Preparing next chapter", "TTS failed", "Job poll failed", "Offline"].includes(eutherBooksStatus)) {
    return eutherBooksStatus;
  }
  return "idle";
}

function eutherBooksProcessStatus(): string {
  const job = eutherBooksJob;
  if (!job) {
    return "";
  }
  const detail = job.progress_detail?.trim();
  if (detail) {
    return detail;
  }
  const label = job.progress_label?.trim();
  if (label) {
    return label;
  }
  if (job.status === "running" && job.audio_files.length) {
    const total = Math.max(job.total_audio_files ?? 0, job.total_chunks ?? 0, job.audio_files.length);
    return `${job.audio_files.length}/${total} audio files are playable.`;
  }
  return "";
}

function eutherBooksVisibleJobNote(): string {
  const error = eutherBooksJob?.error?.trim();
  if (error) {
    return eutherBooksFriendlyError(error);
  }
  return eutherBooksPlaybackStateLabel() || eutherBooksProcessStatus() || eutherBooksPlayerHint();
}

function setEutherBooksPlaybackState(nextState: EutherBooksPlaybackState, status?: string): void {
  eutherBooksPlaybackState = nextState;
  if (status !== undefined) {
    eutherBooksPlayerStatus = status;
  }
}

function setEutherBooksPlaybackError(error: unknown, fallback = "Playback failed"): void {
  setEutherBooksPlaybackState("error", error instanceof Error && error.message ? `${fallback}: ${error.message}` : fallback);
}

function isEutherBooksAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function eutherBooksPlaybackStateLabel(): string {
  switch (eutherBooksPlaybackState) {
    case "loading":
      return "Loading audio";
    case "buffering":
      return eutherBooksPlayerStatus || "Buffering audio";
    case "playing":
      return eutherBooksPlayerStatus || "Playing generated chapter";
    case "paused":
      return eutherBooksPlayerStatus || "Playback paused";
    case "ended":
      return eutherBooksPlayerStatus || "Chapter complete";
    case "error":
      return eutherBooksPlayerStatus || "Playback failed";
    case "idle":
    default:
      return eutherBooksPlayerStatus;
  }
}

function eutherBooksPlaybackButtonLabel(job: EutherBooksJob | null): string {
  const webAudioState = eutherBooksWebAudioState;
  const buffering = Boolean(webAudioState && webAudioState.jobId === job?.id && webAudioState.waitingForMoreAudio);
  const stateBelongsToJob = Boolean(job && (
    eutherBooksPendingAutoplayJobId === job.id
    || eutherBooksBufferedAutoplayJobId === job.id
    || webAudioState?.jobId === job.id
  ));
  if (buffering || (stateBelongsToJob && (eutherBooksPlaybackState === "buffering" || eutherBooksPlaybackState === "loading"))) {
    return "Buffering";
  }
  return isEutherBooksWebAudioPlaying(job) ? "Pause" : "Play";
}

function eutherBooksFriendlyError(error: string): string {
  if (error.includes("SIGTERM") || error.includes("Interrupted by service restart")) {
    return "Generation was interrupted. Start the chapter again to continue.";
  }
  if (error.includes("tesseract")) {
    return "PDF OCR stopped while reading the page. Try the chapter again, or use a text/EPUB source if this PDF keeps failing.";
  }
  if (error.includes("Piper model file does not exist")) {
    return error;
  }
  return error.length > 220 ? `${error.slice(0, 220)}...` : error;
}

function eutherBooksAudioErrorMessage(error: MediaError | null): string {
  switch (error?.code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return "Playback was interrupted.";
    case MediaError.MEDIA_ERR_NETWORK:
      return "Audio could not be loaded from EutherBooks.";
    case MediaError.MEDIA_ERR_DECODE:
      return "Audio file could not be decoded.";
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return "Audio source is not supported.";
    default:
      return "Playback failed.";
  }
}

function normalizeSelectedEutherBooksVoice(): void {
  if (!eutherBooksVoices.length) {
    return;
  }
  const selected = eutherBooksSelectedVoice();
  if (selected && (eutherBooksVoiceModelBackend(selected) ?? "voxcpm2") === selectedEutherBooksModelBackend) {
    return;
  }
  const language = selected?.language?.toLowerCase().startsWith("en") || selectedEutherBooksVoice.startsWith("en-") ? "en" : "sv";
  const mappedVoice = eutherBooksVoiceIdForModelBackend(
    eutherBooksBaseVoiceId(selectedEutherBooksVoice),
    selectedEutherBooksModelBackend,
    language,
  );
  selectedEutherBooksVoice = eutherBooksVoices.some((voice) => voice.id === mappedVoice)
    ? mappedVoice
    : eutherBooksVoices.find((voice) => (eutherBooksVoiceModelBackend(voice) ?? "voxcpm2") === selectedEutherBooksModelBackend && voice.language.startsWith("sv"))?.id
      ?? eutherBooksVoices.find((voice) => (eutherBooksVoiceModelBackend(voice) ?? "voxcpm2") === selectedEutherBooksModelBackend)?.id
      ?? "sv-female-warm";
  localStorage.setItem("eutherbooks-voice", selectedEutherBooksVoice);
}

function clearEutherBooksHealthPoll(): void {
  if (eutherBooksHealthPollTimer !== null) {
    window.clearTimeout(eutherBooksHealthPollTimer);
    eutherBooksHealthPollTimer = null;
  }
}

function scheduleEutherBooksHealthPoll(delayMs = 5000): void {
  clearEutherBooksHealthPoll();
  if (activeWorkspaceWindow !== "books") {
    return;
  }
  eutherBooksHealthPollTimer = window.setTimeout(() => {
    eutherBooksHealthPollTimer = null;
    void refreshEutherBooksHealth(true);
  }, delayMs);
}

async function refreshEutherBooksHealth(render = false): Promise<void> {
  if (eutherBooksHealthLoading) {
    return;
  }
  eutherBooksHealthLoading = true;
  if (render) {
    renderBooksWindowIfActiveUnlessEutherBooksAudioPlaying();
  }
  try {
    eutherBooksHealth = await eutherBooksJson<EutherBooksHealth>("/health");
  } catch (_err) {
    eutherBooksHealth = {
      status: "offline",
      tts_backend: "unknown",
      dots_tts: { ok: false, status: "offline", model_loaded: false },
    };
  } finally {
    eutherBooksHealthLoading = false;
    if (render) {
      renderBooksWindowIfActiveUnlessEutherBooksAudioPlaying();
    }
    scheduleEutherBooksHealthPoll();
  }
}

async function loadEutherBooks(force = false): Promise<void> {
  if ((eutherBooksLoaded && !force) || eutherBooksLoading) {
    return;
  }
  eutherBooksLoading = true;
  eutherBooksStatus = "Scanning";
  renderBooksWindowIfActive();
  try {
    if (!eutherBooksVoices.length || force) {
      await loadEutherBooksVoices();
    }
    eutherBooks = await eutherBooksJson<EutherBook[]>("/books");
    eutherBooksLoaded = true;
    eutherBooksStatus = `${eutherBooks.length} ${eutherBooks.length === 1 ? "book" : "books"}`;
    if (!selectedEutherBookId && eutherBooks[0]) {
      selectedEutherBookId = eutherBooks[0].id;
      persistEutherBooksSelectionPreference(false);
      await loadEutherBookChapters(selectedEutherBookId);
    } else if (selectedEutherBookId && !eutherBooks.some((book) => book.id === selectedEutherBookId)) {
      selectedEutherBookId = eutherBooks[0]?.id ?? null;
      selectedEutherBookChapters = [];
      persistEutherBooksSelectionPreference(false);
      if (selectedEutherBookId) {
        await loadEutherBookChapters(selectedEutherBookId);
      }
    } else if (selectedEutherBookId && !selectedEutherBookChapters.length) {
      await loadEutherBookChapters(selectedEutherBookId);
    }
  } catch (err) {
    eutherBooksLoaded = false;
    eutherBooksStatus = err instanceof Error ? "EutherBooks offline" : "Offline";
  } finally {
    eutherBooksLoading = false;
    renderBooksWindowIfActive();
  }
}

async function uploadEutherBooksFiles(files: File[]): Promise<void> {
  if (!files.length || !canHostManageLibrary()) {
    return;
  }
  const allowed = new Set([".txt", ".md", ".epub", ".pdf"]);
  eutherBooksStatus = `Uploading ${files.length} ${files.length === 1 ? "book" : "books"}`;
  renderBooksWindowIfActive();
  try {
    for (const file of files) {
      const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
      if (!allowed.has(extension)) {
        throw new Error(`Unsupported file: ${file.name}`);
      }
      await eutherBooksJson<EutherBook>(`/books/upload?name=${encodeURIComponent(file.name)}`, {
        method: "POST",
        headers: { "content-type": file.type || "application/octet-stream" },
        body: file,
      });
    }
    eutherBooksLoaded = false;
    eutherBooksStatus = "Upload complete";
    await loadEutherBooks(true);
  } catch (err) {
    eutherBooksStatus = err instanceof Error ? err.message : "Upload failed";
    renderBooksWindowIfActive();
  }
}

async function loadEutherBooksVoices(): Promise<void> {
  try {
    eutherBooksVoices = await eutherBooksJson<EutherBooksVoice[]>("/voices");
    normalizeSelectedEutherBooksVoice();
  } catch (_err) {
    eutherBooksVoices = [];
  }
}

async function selectEutherBook(bookId: string): Promise<void> {
  if (selectedEutherBookId === bookId && selectedEutherBookChapters.length) {
    return;
  }
  selectedEutherBookId = bookId;
  selectedEutherBookChapterIndex = 0;
  persistEutherBooksSelectionPreference();
  selectedEutherBookChapters = [];
  stopEutherBooksWebAudioPlayback(false);
  eutherBooksJob = null;
  eutherBooksPlayableFallbackJob = null;
  eutherBooksAudioIndex = 0;
  eutherBooksPendingAutoplayJobId = null;
  eutherBooksBufferedAutoplayJobId = null;
  eutherBooksPrefetchJobs = [];
  clearEutherBooksPrefetchPoll();
  setEutherBooksPlaybackState("idle", "");
  renderBooksWindowIfActive();
  await loadEutherBookChapters(bookId);
}

async function loadEutherBookChapters(bookId: string): Promise<void> {
  selectedEutherBookChaptersLoading = true;
  eutherBooksStatus = "Loading chapters";
  renderBooksWindowIfActive();
  try {
    selectedEutherBookChapters = await eutherBooksJson<EutherBookChapter[]>(`/books/${encodeURIComponent(bookId)}/chapters`);
    selectedEutherBookChapterIndex = selectedEutherBookChapters.some((chapter) => chapter.index === selectedEutherBookChapterIndex)
      ? selectedEutherBookChapterIndex
      : selectedEutherBookChapters[0]?.index ?? 0;
    persistEutherBooksSelectionPreference(false);
    eutherBooksStatus = `${selectedEutherBookChapters.length} ${selectedEutherBookChapters.length === 1 ? "chapter" : "chapters"}`;
    void attachEutherBooksJobForSelection();
  } catch (err) {
    selectedEutherBookChapters = [];
    eutherBooksStatus = err instanceof Error ? "Chapter load failed" : "Offline";
  } finally {
    selectedEutherBookChaptersLoading = false;
    renderBooksWindowIfActive();
  }
}

async function startEutherBooksTts(chapterIndex = selectedEutherBookChapterIndex, autoplayWhenReady = false, statusLabel?: string): Promise<void> {
  if (eutherBooksTtsSubmitting) {
    return;
  }
  const book = selectedEutherBook();
  if (!book) {
    setEutherBooksPlaybackState("idle", "Select a book first");
    renderBooksWindowIfActive();
    return;
  }
  selectedEutherBookChapterIndex = chapterIndex;
  persistEutherBooksSelectionPreference();
  eutherBooksStatus = statusLabel ?? (autoplayWhenReady ? "Preparing next chapter" : "Generating speech");
  eutherBooksTtsSubmitting = true;
  stopEutherBooksWebAudioPlayback(false);
  eutherBooksJob = null;
  eutherBooksPlayableFallbackJob = null;
  eutherBooksAudioIndex = 0;
  eutherBooksPendingAutoplayJobId = null;
  eutherBooksBufferedAutoplayJobId = null;
  eutherBooksPrefetchJobs = [];
  clearEutherBooksPrefetchPoll();
  setEutherBooksPlaybackState("loading", statusLabel ?? (autoplayWhenReady ? "Preparing next chapter" : "Generating speech"));
  renderBooksWindowIfActive();
  try {
    if (!eutherBooksVoices.length) {
      await loadEutherBooksVoices();
    } else {
      normalizeSelectedEutherBooksVoice();
    }
    eutherBooksJob = await createEutherBooksTtsJob(book.id, chapterIndex, true);
    eutherBooksJobLastCheckedAt = Date.now();
    eutherBooksStatus = eutherBooksJob.status;
    eutherBooksPendingAutoplayJobId = autoplayWhenReady ? eutherBooksJob.id : null;
    void attachEutherBooksReadyFallbackForSelection(eutherBooksJob.id);
    scheduleEutherBooksJobPoll(250);
  } catch (err) {
    eutherBooksStatus = err instanceof Error ? "TTS failed" : "Offline";
    setEutherBooksPlaybackState("error", err instanceof Error ? err.message : "TTS failed");
    eutherBooksPendingAutoplayJobId = null;
  } finally {
    eutherBooksTtsSubmitting = false;
  }
  renderBooksWindowIfActiveUnlessEutherBooksAudioPlaying();
}

async function createEutherBooksTtsJob(bookId: string, chapterIndex: number, cancelExisting = true): Promise<EutherBooksJob> {
  return eutherBooksJson<EutherBooksJob>(`/books/${encodeURIComponent(bookId)}/tts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      owner: hostUsername ?? "anonymous",
      cancel_existing: cancelExisting,
      language: eutherBooksRequestLanguage(),
      voice: eutherBooksRequestVoice(),
      chapters: [chapterIndex],
      length_scale: eutherBooksLengthScale,
      noise_scale: eutherBooksNoiseScale,
      noise_w: eutherBooksNoiseW,
      sentence_silence: eutherBooksSentenceSilence,
      model_backend: eutherBooksEffectiveModelBackend(),
      cfg_value: eutherBooksCfgValue,
      inference_timesteps: eutherBooksInferenceTimesteps,
      dots_template_name: "tts",
      dots_ode_method: "euler",
      dots_num_steps: eutherBooksDotsNumSteps,
      dots_guidance_scale: eutherBooksDotsGuidanceScale,
      dots_speaker_scale: eutherBooksDotsSpeakerScale,
      dots_max_generate_length: eutherBooksDotsMaxGenerateLength,
      max_chunk_chars: eutherBooksIsDotsModel(eutherBooksEffectiveModelBackend()) ? 520 : eutherBooksMaxChunkChars,
      seed: eutherBooksSeed,
      voice_reference_path: eutherBooksRequestVoiceReferencePath(),
      voice_prompt_text: eutherBooksRequestVoicePromptText(),
      queue_remainder: false,
    }),
  });
}

function scheduleEutherBooksJobPoll(delayMs = 1000): void {
  if (eutherBooksJobPollTimer !== null) {
    window.clearTimeout(eutherBooksJobPollTimer);
  }
  if (!eutherBooksJob || eutherBooksJob.status === "done" || eutherBooksJob.status === "failed") {
    return;
  }
  eutherBooksJobPollTimer = window.setTimeout(() => {
    eutherBooksJobPollTimer = null;
    void refreshEutherBooksJob();
  }, delayMs);
}

async function refreshEutherBooksJob(): Promise<void> {
  if (!eutherBooksJob) {
    return;
  }
  try {
    const previousAudioCount = eutherBooksJob.audio_files.length;
    eutherBooksJob = await eutherBooksJson<EutherBooksJob>(`/jobs/${encodeURIComponent(eutherBooksJob.id)}`);
    eutherBooksJobLastCheckedAt = Date.now();
    eutherBooksStatus = eutherBooksJob.status;
    if (eutherBooksJob.status === "done") {
      eutherBooksPlayableFallbackJob = null;
    } else if (!eutherBooksPlayableFallbackJob) {
      void attachEutherBooksReadyFallbackForSelection(eutherBooksJob.id);
    }
    if (eutherBooksJob.audio_files.length) {
      const combinedPlayback = eutherBooksUsesCombinedPlayback(eutherBooksJob);
      loadEutherBooksAudioDurations(eutherBooksJob);
      if (previousAudioCount === 0) {
        eutherBooksAudioIndex = 0;
        if (eutherBooksAutoAdvance) {
          queueEutherBooksBufferedAutoplay(eutherBooksJob, 0, true);
        }
      } else if (!combinedPlayback && eutherBooksBufferedAutoplayJobId === eutherBooksJob.id && eutherBooksAudioIndex + 1 < eutherBooksJob.audio_files.length) {
        const buffer = eutherBooksBufferedAutoplayStatus(eutherBooksJob, eutherBooksBufferedResumeSeconds, false);
        if (!buffer.ready) {
          setEutherBooksPlaybackState("buffering", eutherBooksBufferedAutoplayLabel(eutherBooksJob, eutherBooksBufferedResumeSeconds, false));
          scheduleEutherBooksJobPoll(250);
          renderBooksWindowIfActive();
          return;
        }
      } else if (combinedPlayback) {
        eutherBooksAudioIndex = 0;
      } else {
        eutherBooksAudioIndex = Math.min(eutherBooksAudioIndex, eutherBooksJob.audio_files.length - 1);
      }
      if (eutherBooksPendingAutoplayJobId === eutherBooksJob.id && eutherBooksJob.audio_files.length) {
        const buffer = eutherBooksBufferedAutoplayStatus(
          eutherBooksJob,
          eutherBooksBufferedResumeSeconds,
          eutherBooksBufferedResumeSeconds <= 0.001,
        );
        if (!buffer.ready) {
          setEutherBooksPlaybackState("buffering", eutherBooksBufferedAutoplayLabel(
            eutherBooksJob,
            eutherBooksBufferedResumeSeconds,
            eutherBooksBufferedResumeSeconds <= 0.001,
          ));
          scheduleEutherBooksJobPoll(250);
          renderBooksWindowIfActive();
          return;
        }
        eutherBooksPendingAutoplayJobId = null;
        eutherBooksBufferedAutoplayJobId = null;
        setEutherBooksPlaybackState(eutherBooksJob.status === "done" ? "paused" : "playing", eutherBooksJob.status === "done" ? "Next chapter ready" : "Playing generated chapter");
        renderBooksWindowIfActive();
        playEutherBooksAudioSoon(eutherBooksBufferedResumeSeconds);
        eutherBooksBufferedResumeSeconds = 0;
        eutherBooksBufferedAudioCount = 0;
        return;
      }
    }
    if (eutherBooksJob.status === "failed" && eutherBooksPendingAutoplayJobId === eutherBooksJob.id) {
      eutherBooksPendingAutoplayJobId = null;
    }
    scheduleEutherBooksJobPoll();
  } catch (err) {
    eutherBooksStatus = err instanceof Error ? "Job poll failed" : "Offline";
    setEutherBooksPlaybackState("buffering", "Still waiting for EutherBooks to report progress");
    if (eutherBooksJob.status !== "done" && eutherBooksJob.status !== "failed") {
      scheduleEutherBooksJobPoll(1500);
    }
  }
  renderBooksWindowIfActiveUnlessEutherBooksAudioPlaying();
}

async function attachEutherBooksJobForSelection(): Promise<void> {
  const book = selectedEutherBook();
  if (!book) {
    return;
  }
  if (eutherBooksJob?.book_id === book.id && eutherBooksJob.chapter_indexes.includes(selectedEutherBookChapterIndex)) {
    scheduleEutherBooksJobPoll(250);
    return;
  }
  try {
    const jobs = await eutherBooksJson<EutherBooksJob[]>("/jobs");
    const matching = jobs.filter((job) =>
      job.book_id === book.id
      && job.chapter_indexes.includes(selectedEutherBookChapterIndex)
      && (job.status === "queued" || job.status === "running" || job.audio_files.length > 0)
    );
    const ready = [...matching].reverse().find((job) => job.status === "done" && job.audio_files.length > 0);
    const active = [...matching].reverse().find((job) => job.status === "queued" || job.status === "running");
    const nextJob = ready ?? active ?? null;
    if (!nextJob) {
      return;
    }
    eutherBooksJob = nextJob;
    eutherBooksPlayableFallbackJob = null;
    eutherBooksJobLastCheckedAt = Date.now();
    const playbackJob = currentEutherBooksPlaybackJob();
    eutherBooksAudioIndex = playbackJob ? Math.min(eutherBooksAudioIndex, Math.max(0, playbackJob.audio_files.length - 1)) : 0;
    eutherBooksStatus = nextJob.status;
    eutherBooksPlayerStatus = ready
      ? active
        ? "Loaded generated audio; backend is also preparing a newer job"
        : "Loaded generated audio"
      : "Found running backend job";
    if (active && nextJob.id === active.id) {
      scheduleEutherBooksJobPoll(250);
    }
  } catch (_err) {
    return;
  }
  renderBooksWindowIfActive();
}

async function attachEutherBooksReadyFallbackForSelection(excludeJobId: string): Promise<void> {
  const book = selectedEutherBook();
  if (!book) {
    return;
  }
  try {
    const jobs = await eutherBooksJson<EutherBooksJob[]>("/jobs");
    eutherBooksPlayableFallbackJob = [...jobs]
      .reverse()
      .find((job) =>
        job.id !== excludeJobId
        && job.book_id === book.id
        && job.chapter_indexes.includes(selectedEutherBookChapterIndex)
        && job.status === "done"
        && job.audio_files.length > 0
        && eutherBooksJobCanBePlaybackFallback(job)
      ) ?? null;
  } catch (_err) {
    return;
  }
  renderBooksWindowIfActive();
}

function eutherBooksJobCanBePlaybackFallback(job: EutherBooksJob): boolean {
  if (eutherBooksJob) {
    return eutherBooksJobsUseSameTtsSettings(job, eutherBooksJob);
  }
  return eutherBooksJobMatchesCurrentRequest(job);
}

function eutherBooksJobsUseSameTtsSettings(candidate: EutherBooksJob, reference: EutherBooksJob): boolean {
  if (candidate.voice !== reference.voice || candidate.language !== reference.language) {
    return false;
  }
  return eutherBooksTtsOptionKeys().every((key) => eutherBooksSameOption(candidate.tts_options?.[key], reference.tts_options?.[key]));
}

function eutherBooksJobMatchesCurrentRequest(job: EutherBooksJob): boolean {
  if (job.voice !== eutherBooksRequestVoice() || job.language !== eutherBooksRequestLanguage()) {
    return false;
  }
  return eutherBooksTtsOptionKeys().every((key) => eutherBooksSameOption(job.tts_options?.[key], eutherBooksCurrentTtsOptions()[key]));
}

function eutherBooksCurrentTtsOptions(): Record<string, number | string> {
  return {
    model_backend: eutherBooksEffectiveModelBackend(),
    dots_template_name: "tts",
    dots_ode_method: "euler",
    dots_num_steps: eutherBooksDotsNumSteps,
    dots_guidance_scale: eutherBooksDotsGuidanceScale,
    dots_speaker_scale: eutherBooksDotsSpeakerScale,
    dots_max_generate_length: eutherBooksDotsMaxGenerateLength,
    max_chunk_chars: eutherBooksIsDotsModel(eutherBooksEffectiveModelBackend()) ? 520 : eutherBooksMaxChunkChars,
    seed: eutherBooksSeed,
    voice_reference_path: eutherBooksRequestVoiceReferencePath(),
    voice_prompt_text: eutherBooksRequestVoicePromptText(),
  };
}

function eutherBooksCurrentTtsSettingsHash(): string {
  return eutherBooksTtsSettingsHash(eutherBooksRequestVoice(), eutherBooksRequestLanguage(), eutherBooksCurrentTtsOptions());
}

function eutherBooksJobTtsSettingsHash(job: EutherBooksJob): string {
  return eutherBooksTtsSettingsHash(job.voice, job.language, job.tts_options ?? {});
}

function eutherBooksTtsSettingsHash(voice: string, language: string, options: Record<string, unknown>): string {
  const normalized: Record<string, string | number | boolean> = {
    language: language.trim().toLowerCase(),
    voice: voice.trim(),
  };
  for (const key of eutherBooksTtsOptionKeys()) {
    const value = options[key];
    if (value === undefined || value === null || value === "") {
      continue;
    }
    normalized[key] = typeof value === "number" ? Number(value) : String(value).trim();
  }
  return JSON.stringify(Object.keys(normalized).sort().map((key) => [key, normalized[key]]));
}

function eutherBooksTtsOptionKeys(): string[] {
  return [
    "model_backend",
    "dots_template_name",
    "dots_ode_method",
    "dots_num_steps",
    "dots_guidance_scale",
    "dots_speaker_scale",
    "dots_max_generate_length",
    "max_chunk_chars",
    "seed",
    "voice_reference_path",
    "voice_prompt_text",
  ];
}

function eutherBooksSameOption(left: unknown, right: unknown): boolean {
  if (left === undefined || left === null || left === "") {
    return right === undefined || right === null || right === "";
  }
  if (right === undefined || right === null || right === "") {
    return false;
  }
  if (typeof left === "number" || typeof right === "number") {
    return Number(left) === Number(right);
  }
  return String(left).trim() === String(right).trim();
}

function clearEutherBooksPrefetchPoll(): void {
  if (eutherBooksPrefetchPollTimer !== null) {
    window.clearTimeout(eutherBooksPrefetchPollTimer);
    eutherBooksPrefetchPollTimer = null;
  }
}

function scheduleEutherBooksPrefetchPoll(): void {
  clearEutherBooksPrefetchPoll();
  if (!eutherBooksPrefetchJobs.some((job) => job.status !== "done" && job.status !== "failed")) {
    return;
  }
  eutherBooksPrefetchPollTimer = window.setTimeout(() => {
    eutherBooksPrefetchPollTimer = null;
    void refreshEutherBooksPrefetchJobs();
  }, 1500);
}

async function refreshEutherBooksPrefetchJobs(): Promise<void> {
  if (!eutherBooksPrefetchJobs.length) {
    return;
  }
  try {
    eutherBooksPrefetchJobs = await Promise.all(
      eutherBooksPrefetchJobs.map((job) => eutherBooksJson<EutherBooksJob>(`/jobs/${encodeURIComponent(job.id)}`)),
    );
    const waitingJob = eutherBooksPendingAutoplayJobId
      ? eutherBooksPrefetchJobs.find((job) => job.id === eutherBooksPendingAutoplayJobId)
      : null;
    if (waitingJob?.audio_files.length) {
      switchToEutherBooksPrefetchJob(waitingJob, true);
      return;
    }
    scheduleEutherBooksPrefetchPoll();
  } catch (_err) {
    if (!eutherBooksJob || eutherBooksJob.status === "done" || eutherBooksJob.status === "failed") {
      setEutherBooksPlaybackState("error", "Next chapter prefetch failed");
    }
  }
  renderBooksWindowIfActiveUnlessEutherBooksAudioPlaying();
}

function maybePrefetchEutherBooksNextChapter(): void {
  if (!eutherBooksAutoGenerateNext || eutherBooksPendingAutoplayJobId) {
    return;
  }
  const now = Date.now();
  if (now - eutherBooksPrefetchCheckAt < 5000) {
    return;
  }
  eutherBooksPrefetchCheckAt = now;
  const job = currentEutherBooksPlaybackJob();
  if (!job || !job.audio_files.length) {
    return;
  }
  if (!nextEutherBookChapter()) {
    return;
  }
  const current = eutherBooksVirtualCurrentTime(job, currentEutherBooksAudio());
  const total = eutherBooksVirtualTotalDuration(job);
  if (!(total > 0) || !(current > 0)) {
    return;
  }
  const remaining = Math.max(0, total - current);
  const playedFraction = current / total;
  if (
    job.status === "done"
    || remaining <= EUTHERBOOKS_NEXT_CHAPTER_PREFETCH_SECONDS
    || playedFraction >= EUTHERBOOKS_NEXT_CHAPTER_PREFETCH_FRACTION
    || (current >= 120 && job.audio_files.length >= EUTHERBOOKS_AUTOPLAY_MIN_START_PARTS)
  ) {
    void ensureEutherBooksNextChapterPrefetched();
  }
}

async function ensureEutherBooksNextChapterPrefetched(): Promise<void> {
  if (!eutherBooksAutoGenerateNext || eutherBooksPendingAutoplayJobId) {
    return;
  }
  if (!eutherBooksJob || eutherBooksJob.audio_files.length === 0) {
    return;
  }
  const book = selectedEutherBook();
  const upcomingChapters = upcomingEutherBookChapters(1);
  if (!book || !upcomingChapters.length) {
    return;
  }
  try {
    eutherBooksPrefetchJobs = eutherBooksPrefetchJobs.filter((job) =>
      upcomingChapters.some((chapter) => eutherBooksPrefetchMatches(book.id, chapter.index, job)),
    );
    for (const chapter of upcomingChapters) {
      if (eutherBooksPrefetchJobs.some((job) => eutherBooksPrefetchMatches(book.id, chapter.index, job))) {
        continue;
      }
      eutherBooksPrefetchJobs.push(await createEutherBooksTtsJob(book.id, chapter.index, false));
    }
    scheduleEutherBooksPrefetchPoll();
  } catch (_err) {
    if (!eutherBooksJob || eutherBooksJob.status === "done" || eutherBooksJob.status === "failed") {
      setEutherBooksPlaybackState("error", "Next chapter prefetch failed");
    }
  }
  renderBooksWindowIfActiveUnlessEutherBooksAudioPlaying();
}

function eutherBooksPrefetchMatches(bookId: string, chapterIndex: number, job: EutherBooksJob): boolean {
  return job.book_id === bookId
    && job.chapter_indexes.length === 1
    && job.chapter_indexes[0] === chapterIndex
    && eutherBooksJobMatchesCurrentRequest(job);
}

async function eutherBooksJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const method = (init.method ?? "GET").toUpperCase();
  if (eutherBooksUsesHostProxy && !["GET", "HEAD", "OPTIONS"].includes(method) && !hostCsrfToken) {
    await refreshAuthStatus();
  }
  if (eutherBooksUsesHostProxy && !["GET", "HEAD", "OPTIONS"].includes(method) && hostCsrfToken) {
    headers.set("X-CSRF-Token", hostCsrfToken);
  }
  const response = await fetch(`${eutherBooksBase}${path}`, { ...init, headers, credentials: "include" });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail ? `EutherBooks ${response.status}: ${detail.slice(0, 240)}` : `EutherBooks ${response.status}`);
  }
  return (await response.json()) as T;
}

function selectedEutherBook(): EutherBook | null {
  return eutherBooks.find((book) => book.id === selectedEutherBookId) ?? null;
}

function eutherBooksAudioUrl(path: string): string {
  return `${eutherBooksBase}/audio/${path.split("/").map(encodeURIComponent).join("/")}`;
}

function eutherBooksJobAudioUrl(job: EutherBooksJob): string {
  return `${eutherBooksBase}/jobs/${encodeURIComponent(job.id)}/audio`;
}

function eutherBooksUsesCombinedPlayback(job: EutherBooksJob | null): boolean {
  return false;
}

function eutherBooksUsesWebAudioPlayback(job: EutherBooksJob | null): boolean {
  return Boolean(job && !eutherBooksUsesCombinedPlayback(job) && job.audio_files.length > 0);
}

function eutherBooksAudioPartLabel(path: string, index: number): string {
  const match = path.match(/\/(\d{4})-(\d{3})\.wav$/);
  if (!match) {
    return `Part ${index + 1}`;
  }
  return `Page ${Number(match[1]) + 1}, part ${Number(match[2]) + 1}`;
}

function eutherBooksBookmarkKey(bookId: string): string {
  return `eutherbooks-bookmark-${bookId}`;
}

function eutherBooksBookmarkFor(bookId: string): EutherBooksBookmark | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(eutherBooksBookmarkKey(bookId)) ?? "null") as Partial<EutherBooksBookmark> | null;
    if (
      !parsed
      || parsed.book_id !== bookId
      || typeof parsed.chapter_index !== "number"
      || typeof parsed.audio_index !== "number"
      || typeof parsed.audio_path !== "string"
      || typeof parsed.current_time !== "number"
    ) {
      return null;
    }
    return {
      book_id: parsed.book_id,
      chapter_index: parsed.chapter_index,
      audio_index: parsed.audio_index,
      audio_path: parsed.audio_path,
      current_time: Math.max(0, parsed.current_time),
      duration: typeof parsed.duration === "number" ? Math.max(0, parsed.duration) : null,
      updated_at: typeof parsed.updated_at === "number" ? parsed.updated_at : 0,
    };
  } catch (_err) {
    return null;
  }
}

function eutherBooksBookmarkLabel(bookmark: EutherBooksBookmark): string {
  const chapter = selectedEutherBookChapters.find((candidate) => candidate.index === bookmark.chapter_index);
  const chapterLabel = chapter?.title ?? `Chapter ${bookmark.chapter_index + 1}`;
  return `${chapterLabel} / ${formatDuration(bookmark.current_time)}`;
}

function eutherBooksVirtualPlayerMarkup(job: EutherBooksJob | null, audioSource: string | null): string {
  if (!audioSource) {
    return `<div class="eutherbooks-audio-waiting">${escapeHtml(eutherBooksAudioWaitingLabel())}</div>`;
  }
  loadEutherBooksAudioDurations(job);
  const timeline = eutherBooksPlaybackTimeline(job, currentEutherBooksAudio());
  const total = timeline.total;
  const current = timeline.current;
  const max = Math.max(total, current, 0.01);
  if (eutherBooksUsesWebAudioPlayback(job)) {
    return `
      <div class="eutherbooks-virtual-player" data-eutherbooks-web-audio-player>
        <button data-eutherbooks-web-audio-toggle type="button">${escapeHtml(eutherBooksPlaybackButtonLabel(job))}</button>
        <input data-eutherbooks-virtual-seek type="range" min="0" max="${max.toFixed(3)}" step="0.05" value="${Math.min(current, max).toFixed(3)}" aria-label="Audiobook position">
        <span data-eutherbooks-virtual-time>${escapeHtml(formatDuration(current))} / ${escapeHtml(total > 0 ? formatDuration(total) : "--:--")}</span>
      </div>
    `;
  }
  return `
    <div class="eutherbooks-virtual-player">
      <audio data-eutherbooks-audio controls preload="auto" src="${escapeHtml(audioSource)}"></audio>
      <input data-eutherbooks-virtual-seek type="range" min="0" max="${max.toFixed(3)}" step="0.05" value="${Math.min(current, max).toFixed(3)}" aria-label="Audiobook position">
      <span data-eutherbooks-virtual-time>${escapeHtml(formatDuration(current))} / ${escapeHtml(total > 0 ? formatDuration(total) : "--:--")}</span>
    </div>
  `;
}

function eutherBooksPlaybackBufferMarkup(timeline: EutherBooksPlaybackTimeline): string {
  if (!timeline.readyAudioFiles) {
    return "";
  }
  const generatedLabel = timeline.isComplete
    ? `Generated ${formatDuration(timeline.generatedUntil)}`
    : `Generated ${formatDuration(timeline.generatedUntil)}${timeline.totalAudioFiles > timeline.readyAudioFiles ? ` (${timeline.readyAudioFiles}/${timeline.totalAudioFiles} parts)` : ""}`;
  const scheduledLabel = timeline.isWebAudio && timeline.scheduledUntil > timeline.current
    ? `Scheduled ${Math.floor(timeline.bufferAhead)}s ahead`
    : timeline.isWebAudio
      ? "Waiting for decoded audio"
      : "HTML audio";
  return `
    <div class="eutherbooks-playback-buffer" data-eutherbooks-playback-buffer>
      <span>${escapeHtml(generatedLabel)}</span>
      <strong>${escapeHtml(scheduledLabel)}</strong>
    </div>
  `;
}

function eutherBooksPlaybackDebugMarkup(timeline: EutherBooksPlaybackTimeline): string {
  const state = eutherBooksWebAudioState;
  const rows = [
    ["state", eutherBooksPlaybackState],
    ["job", currentEutherBooksPlaybackJob()?.id?.slice(0, 10) ?? "-"],
    ["session", state ? String(state.sessionId) : "-"],
    ["settings", state?.settingsHash.slice(0, 10) ?? eutherBooksCurrentTtsSettingsHash().slice(0, 10)],
    ["current", timeline.current.toFixed(2)],
    ["total", timeline.total.toFixed(2)],
    ["generated", timeline.generatedUntil.toFixed(2)],
    ["scheduled", timeline.scheduledUntil.toFixed(2)],
    ["buffer", timeline.bufferAhead.toFixed(2)],
    ["sources", state ? String(state.sources.size) : "0"],
    ["audioctx", state?.context.state ?? "-"],
  ];
  return `
    <div class="eutherbooks-playback-debug ${eutherBooksPlaybackDebugOpen ? "is-open" : ""}">
      <button data-eutherbooks-playback-debug-toggle type="button">${eutherBooksPlaybackDebugOpen ? "Hide player debug" : "Show player debug"}</button>
      ${eutherBooksPlaybackDebugOpen ? `<dl>${rows.map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`).join("")}</dl>` : ""}
    </div>
  `;
}

function eutherBooksChunkDurations(job: EutherBooksJob | null): number[] {
  const audioFiles = job?.audio_files ?? [];
  const durations = job?.audio_durations ?? [];
  return audioFiles.map((path, index) => {
    const duration = Number(eutherBooksAudioDurationCache.get(path) ?? durations[index] ?? 0);
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
  });
}

function eutherBooksVirtualTotalDuration(job: EutherBooksJob | null): number {
  return eutherBooksChunkDurations(job).reduce((sum, duration) => sum + duration, 0);
}

function eutherBooksPlaybackTimeline(job: EutherBooksJob | null, audio: HTMLAudioElement | null): EutherBooksPlaybackTimeline {
  const current = eutherBooksVirtualCurrentTime(job, audio);
  const generatedUntil = eutherBooksVirtualTotalDuration(job);
  const state = eutherBooksWebAudioState;
  const scheduledUntil = state && job && state.jobId === job.id ? Math.max(state.scheduledUntil, state.virtualStartedAt) : generatedUntil;
  const totalAudioFiles = Math.max(job?.total_audio_files ?? 0, job?.total_chunks ?? 0, job?.audio_files.length ?? 0);
  const isComplete = job?.status === "done" || job?.status === "failed";
  const knownTotal = isComplete ? generatedUntil : Math.max(generatedUntil, current);
  const bufferAhead = Math.max(0, Math.min(generatedUntil, scheduledUntil) - current);
  return {
    current,
    total: knownTotal,
    generatedUntil,
    scheduledUntil,
    bufferAhead,
    readyAudioFiles: job?.audio_files.length ?? 0,
    totalAudioFiles,
    isComplete,
    isWebAudio: eutherBooksUsesWebAudioPlayback(job),
  };
}

function eutherBooksPlayableBufferAhead(job: EutherBooksJob | null, fromSeconds: number): number {
  return Math.max(0, eutherBooksVirtualTotalDuration(job) - Math.max(0, fromSeconds));
}

function eutherBooksBufferedAutoplayStatus(
  job: EutherBooksJob | null,
  fromSeconds: number,
  initialStart: boolean,
): { ready: boolean; available: number; required: number; waitingForParts: boolean } {
  if (!job || !job.audio_files.length) {
    return {
      ready: false,
      available: 0,
      required: initialStart ? EUTHERBOOKS_AUTOPLAY_START_BUFFER_SECONDS : EUTHERBOOKS_AUTOPLAY_RESUME_BUFFER_SECONDS,
      waitingForParts: true,
    };
  }
  const done = job.status === "done" || job.status === "failed";
  const available = eutherBooksPlayableBufferAhead(job, fromSeconds);
  const required = initialStart ? EUTHERBOOKS_AUTOPLAY_START_BUFFER_SECONDS : EUTHERBOOKS_AUTOPLAY_RESUME_BUFFER_SECONDS;
  const waitingForParts = initialStart && job.audio_files.length < EUTHERBOOKS_AUTOPLAY_MIN_START_PARTS && !done;
  const hasEnoughUnknownDurationParts = available <= 0
    && job.audio_files.length >= (initialStart ? EUTHERBOOKS_AUTOPLAY_MIN_START_PARTS : Math.max(eutherBooksBufferedAudioCount + 1, 1));
  return {
    ready: done || (!waitingForParts && (available >= required || hasEnoughUnknownDurationParts)),
    available,
    required,
    waitingForParts,
  };
}

function eutherBooksBufferedAutoplayLabel(job: EutherBooksJob | null, fromSeconds: number, initialStart: boolean): string {
  const status = eutherBooksBufferedAutoplayStatus(job, fromSeconds, initialStart);
  if (status.waitingForParts) {
    return `Buffering ${job?.audio_files.length ?? 0}/${EUTHERBOOKS_AUTOPLAY_MIN_START_PARTS} parts`;
  }
  return `Buffering ${Math.floor(status.available)}s / ${status.required}s`;
}

function queueEutherBooksBufferedAutoplay(job: EutherBooksJob, fromSeconds: number, initialStart: boolean): void {
  eutherBooksPendingAutoplayJobId = job.id;
  eutherBooksBufferedAutoplayJobId = initialStart ? null : job.id;
  eutherBooksBufferedResumeSeconds = Math.max(0, fromSeconds);
  eutherBooksBufferedAudioCount = job.audio_files.length;
  setEutherBooksPlaybackState("buffering", eutherBooksBufferedAutoplayLabel(job, fromSeconds, initialStart));
  scheduleEutherBooksJobPoll(250);
}

function eutherBooksChunkStartTime(job: EutherBooksJob | null, index: number): number {
  const durations = eutherBooksChunkDurations(job);
  return durations.slice(0, Math.max(0, index)).reduce((sum, duration) => sum + duration, 0);
}

function loadEutherBooksAudioDurations(job: EutherBooksJob | null): void {
  const audioFiles = job?.audio_files ?? [];
  for (const path of audioFiles) {
    if (eutherBooksAudioDurationCache.has(path)) {
      continue;
    }
    const probe = new Audio(eutherBooksAudioUrl(path));
    probe.preload = "metadata";
    probe.addEventListener("loadedmetadata", () => {
      if (Number.isFinite(probe.duration) && probe.duration > 0) {
        eutherBooksAudioDurationCache.set(path, probe.duration);
        const currentJob = currentEutherBooksPlaybackJob();
        if (currentJob?.audio_files.includes(path)) {
          updateEutherBooksVirtualPlayerDom(currentEutherBooksAudio());
        }
      }
    }, { once: true });
    probe.addEventListener("error", () => {
      eutherBooksAudioDurationCache.set(path, 0);
    }, { once: true });
    probe.load();
  }
}

type EutherBooksDecodedAudioChunk = {
  path: string;
  buffer: AudioBuffer;
  trimStart: number;
  trimEnd: number;
  duration: number;
};

type EutherBooksWebAudioState = {
  context: AudioContext;
  sessionId: number;
  jobId: string;
  settingsHash: string;
  abortController: AbortController;
  sources: Set<AudioBufferSourceNode>;
  timer: number | null;
  playing: boolean;
  virtualStartedAt: number;
  contextStartedAt: number;
  scheduledUntil: number;
  scheduledIndex: number;
  renderToken: number;
  waitingForMoreAudio: boolean;
  scheduling: Promise<void> | null;
};

function audioContextConstructor(): typeof AudioContext | null {
  return window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ?? null;
}

function ensureEutherBooksAudioContext(): AudioContext | null {
  if (eutherBooksWebAudioState?.context) {
    return eutherBooksWebAudioState.context;
  }
  const AudioCtor = audioContextConstructor();
  return AudioCtor ? new AudioCtor() : null;
}

async function decodedEutherBooksAudioChunk(path: string, signal?: AbortSignal): Promise<EutherBooksDecodedAudioChunk> {
  const mutable = eutherBooksAudioPathIsMutable(path);
  const cached = mutable || signal ? null : eutherBooksWebAudioChunkCache.get(path);
  if (cached) {
    return cached;
  }
  const promise = (async () => {
    const context = ensureEutherBooksAudioContext();
    if (!context) {
      throw new Error("WebAudio is not supported in this browser.");
    }
    const response = await fetch(eutherBooksAudioUrl(path), { credentials: "include", cache: "no-store", signal });
    if (!response.ok) {
      throw new Error(`Audio fetch failed: ${response.status}`);
    }
    const bytes = await response.arrayBuffer();
    if (signal?.aborted) {
      throw new DOMException("Playback session was cancelled", "AbortError");
    }
    const buffer = await context.decodeAudioData(bytes);
    if (signal?.aborted) {
      throw new DOMException("Playback session was cancelled", "AbortError");
    }
    const trim = eutherBooksAudioTrim(buffer);
    const decoded = {
      path,
      buffer,
      trimStart: trim.start,
      trimEnd: trim.end,
      duration: Math.max(0, trim.end - trim.start),
    };
    if (decoded.duration > 0) {
      eutherBooksAudioDurationCache.set(path, decoded.duration);
    }
    return decoded;
  })();
  if (!mutable && !signal) {
    eutherBooksWebAudioChunkCache.set(path, promise);
  }
  return promise;
}

function eutherBooksAudioPathIsMutable(path: string): boolean {
  return path.includes(".stream-");
}

function eutherBooksAudioTrim(buffer: AudioBuffer): { start: number; end: number } {
  const sampleRate = buffer.sampleRate;
  const frameCount = buffer.length;
  if (frameCount <= 0) {
    return { start: 0, end: 0 };
  }
  const threshold = 0.004;
  const padFrames = Math.round(sampleRate * 0.035);
  let first = 0;
  let last = frameCount - 1;
  outerStart:
  for (; first < frameCount; first += 1) {
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      if (Math.abs(buffer.getChannelData(channel)[first]) >= threshold) {
        break outerStart;
      }
    }
  }
  outerEnd:
  for (; last > first; last -= 1) {
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      if (Math.abs(buffer.getChannelData(channel)[last]) >= threshold) {
        break outerEnd;
      }
    }
  }
  return {
    start: Math.max(0, (first - padFrames) / sampleRate),
    end: Math.min(buffer.duration, (last + padFrames) / sampleRate),
  };
}

function eutherBooksWebAudioCurrentTime(job: EutherBooksJob | null): number | null {
  const state = eutherBooksWebAudioState;
  if (!state || !job || state.jobId !== job.id) {
    return null;
  }
  if (!state.playing || state.waitingForMoreAudio) {
    return state.virtualStartedAt;
  }
  return Math.max(0, state.virtualStartedAt + (state.context.currentTime - state.contextStartedAt));
}

function isEutherBooksWebAudioPlaying(job: EutherBooksJob | null = currentEutherBooksPlaybackJob()): boolean {
  return Boolean(eutherBooksWebAudioState?.playing && job && eutherBooksWebAudioState.jobId === job.id);
}

function updateEutherBooksMediaSession(job: EutherBooksJob | null, state: MediaSessionPlaybackState = "none"): void {
  if (!("mediaSession" in navigator)) {
    return;
  }
  const book = selectedEutherBook();
  const chapter = selectedEutherBookChapters.find((candidate) => candidate.index === selectedEutherBookChapterIndex);
  navigator.mediaSession.metadata = book
    ? new MediaMetadata({
        title: chapter?.title ?? book.title,
        artist: book.author ?? "EutherBooks",
        album: book.title,
      })
    : null;
  navigator.mediaSession.playbackState = state;
  try {
    navigator.mediaSession.setActionHandler("play", () => {
      void startEutherBooksWebAudioPlayback(eutherBooksVirtualCurrentTime(job, null));
    });
    navigator.mediaSession.setActionHandler("pause", () => {
      stopEutherBooksWebAudioPlayback(true);
      saveEutherBooksBookmark("pause");
      renderBooksWindowIfActive();
    });
    navigator.mediaSession.setActionHandler("seekbackward", () => {
      seekEutherBooksVirtualTime(Math.max(0, eutherBooksVirtualCurrentTime(job, null) - 15), isEutherBooksAudioPlaying());
    });
    navigator.mediaSession.setActionHandler("seekforward", () => {
      const total = eutherBooksVirtualTotalDuration(job);
      seekEutherBooksVirtualTime(Math.min(Math.max(0, total - 0.2), eutherBooksVirtualCurrentTime(job, null) + 15), isEutherBooksAudioPlaying());
    });
  } catch (_err) {
    // Some mobile browsers expose Media Session partially.
  }
}

function stopEutherBooksWebAudioPlayback(keepPosition = true): void {
  const state = eutherBooksWebAudioState;
  if (!state) {
    eutherBooksPlaybackSessionCounter += 1;
    return;
  }
  eutherBooksPlaybackSessionCounter += 1;
  state.abortController.abort();
  const current = keepPosition ? eutherBooksWebAudioCurrentTime(currentEutherBooksPlaybackJob()) ?? state.virtualStartedAt : 0;
  for (const source of state.sources) {
    try {
      source.stop();
    } catch (_err) {
      // Already stopped.
    }
  }
  state.sources.clear();
  if (state.timer !== null) {
    window.clearInterval(state.timer);
    state.timer = null;
  }
  state.playing = false;
  state.virtualStartedAt = current;
  state.contextStartedAt = state.context.currentTime;
  state.scheduledUntil = current;
  state.waitingForMoreAudio = false;
  setEutherBooksPlaybackState(keepPosition ? "paused" : "idle");
  updateEutherBooksMediaSession(currentEutherBooksPlaybackJob(), keepPosition ? "paused" : "none");
  updateEutherBooksVirtualPlayerDom(null);
}

function pauseEutherBooksWebAudioForBuffering(state: EutherBooksWebAudioState, job: EutherBooksJob, current: number): void {
  const bufferedAt = Math.max(0, current);
  for (const source of state.sources) {
    try {
      source.stop();
    } catch (_err) {
      // Already stopped.
    }
  }
  state.sources.clear();
  state.virtualStartedAt = bufferedAt;
  state.contextStartedAt = state.context.currentTime;
  state.scheduledUntil = bufferedAt;
  state.waitingForMoreAudio = true;
  updateEutherBooksMediaSession(job, "paused");
  queueEutherBooksBufferedAutoplay(job, bufferedAt, false);
}

async function toggleEutherBooksWebAudioPlayback(): Promise<void> {
  const job = currentEutherBooksPlaybackJob();
  if (!eutherBooksUsesWebAudioPlayback(job)) {
    playEutherBooksAudioSoon(0);
    return;
  }
  if (isEutherBooksWebAudioPlaying(job)) {
    stopEutherBooksWebAudioPlayback(true);
    eutherBooksPendingAutoplayJobId = null;
    eutherBooksBufferedAutoplayJobId = null;
    saveEutherBooksBookmark("pause");
    renderBooksWindowIfActive();
    return;
  }
  await startEutherBooksWebAudioPlayback(eutherBooksWebAudioCurrentTime(job) ?? eutherBooksVirtualCurrentTime(job, currentEutherBooksAudio()));
}

async function startEutherBooksWebAudioPlayback(startTime: number): Promise<void> {
  const job = currentEutherBooksPlaybackJob();
  if (!job || !eutherBooksUsesWebAudioPlayback(job)) {
    return;
  }
  const playbackJob = job;
  const context = ensureEutherBooksAudioContext();
  if (!context) {
    setEutherBooksPlaybackState("error", "WebAudio is not supported in this browser");
    renderBooksWindowIfActive();
    return;
  }
  if (context.state === "suspended") {
    await context.resume();
  }
  stopEutherBooksWebAudioPlayback(false);
  const sessionId = eutherBooksPlaybackSessionCounter + 1;
  eutherBooksPlaybackSessionCounter = sessionId;
  const virtualTime = Math.max(0, startTime);
  eutherBooksWebAudioState = {
    context,
    sessionId,
    jobId: playbackJob.id,
    settingsHash: eutherBooksJobTtsSettingsHash(playbackJob),
    abortController: new AbortController(),
    sources: new Set<AudioBufferSourceNode>(),
    timer: null,
    playing: true,
    virtualStartedAt: virtualTime,
    contextStartedAt: context.currentTime,
    scheduledUntil: virtualTime,
    scheduledIndex: eutherBooksVirtualSeekTarget(playbackJob, virtualTime)?.index ?? 0,
    renderToken: eutherBooksAudioRenderToken,
    waitingForMoreAudio: false,
    scheduling: null,
  };
  setEutherBooksPlaybackState("playing", "Playing generated chapter");
  updateEutherBooksMediaSession(playbackJob, "playing");
  renderBooksWindowIfActive();
  try {
    await scheduleEutherBooksWebAudioAhead();
  } catch (err) {
    if (isEutherBooksAbortError(err)) {
      return;
    }
    if (eutherBooksWebAudioState?.sessionId === sessionId) {
      stopEutherBooksWebAudioPlayback(true);
      setEutherBooksPlaybackError(err);
      renderBooksWindowIfActive();
    }
    return;
  }
  const state = eutherBooksWebAudioState;
  if (!state || state.jobId !== playbackJob.id || state.sessionId !== sessionId) {
    return;
  }
  state.timer = window.setInterval(() => {
    updateEutherBooksWebAudioPlayback();
  }, 120);
}

async function scheduleEutherBooksWebAudioAhead(): Promise<void> {
  const state = eutherBooksWebAudioState;
  const job = currentEutherBooksPlaybackJob();
  if (!state || !job || state.jobId !== job.id || state.sessionId !== eutherBooksPlaybackSessionCounter || !state.playing) {
    return;
  }
  if (state.scheduling) {
    return state.scheduling;
  }
  const scheduling = scheduleEutherBooksWebAudioAheadLocked(state, job);
  state.scheduling = scheduling;
  try {
    await scheduling;
  } finally {
    if (eutherBooksWebAudioState === state && state.scheduling === scheduling) {
      state.scheduling = null;
    }
  }
}

async function scheduleEutherBooksWebAudioAheadLocked(state: EutherBooksWebAudioState, job: EutherBooksJob): Promise<void> {
  if (state.settingsHash !== eutherBooksJobTtsSettingsHash(job)) {
    throw new Error("Playback settings changed; restart audio.");
  }
  const current = eutherBooksWebAudioCurrentTime(job) ?? state.virtualStartedAt;
  const targetUntil = current + EUTHERBOOKS_WEB_AUDIO_SCHEDULE_AHEAD_SECONDS;
  let cursorVirtual = Math.max(state.scheduledUntil, current);
  let when = state.context.currentTime + Math.max(0, cursorVirtual - current);
  let target = eutherBooksVirtualSeekTarget(job, cursorVirtual);
  if (!target) {
    return;
  }
  while (target.index < job.audio_files.length && cursorVirtual < targetUntil && state.playing) {
    const path = job.audio_files[target.index];
    const sessionId = state.sessionId;
    const decoded = await decodedEutherBooksAudioChunk(path, state.abortController.signal);
    if (!state.playing || eutherBooksWebAudioState !== state || state.sessionId !== sessionId || state.sessionId !== eutherBooksPlaybackSessionCounter) {
      return;
    }
    const offset = Math.min(Math.max(0, target.offset), decoded.duration);
    const duration = Math.max(0, decoded.duration - offset);
    if (duration <= 0.01) {
      cursorVirtual += duration;
      target = { index: target.index + 1, offset: 0 };
      continue;
    }
    const source = state.context.createBufferSource();
    source.buffer = decoded.buffer;
    const gain = state.context.createGain();
    const fade = Math.min(EUTHERBOOKS_WEB_AUDIO_CROSSFADE_SECONDS, duration / 3);
    gain.gain.setValueAtTime(target.index === 0 && offset <= 0.001 ? 1 : 0, when);
    gain.gain.linearRampToValueAtTime(1, when + fade);
    gain.gain.setValueAtTime(1, Math.max(when + fade, when + duration - fade));
    gain.gain.linearRampToValueAtTime(0, when + duration);
    source.connect(gain).connect(state.context.destination);
    source.addEventListener("ended", () => {
      state.sources.delete(source);
    }, { once: true });
    state.sources.add(source);
    source.start(when, decoded.trimStart + offset, duration);
    const advance = Math.max(0.01, duration - fade);
    cursorVirtual += advance;
    when += advance;
    state.scheduledUntil = cursorVirtual;
    state.scheduledIndex = target.index;
    state.waitingForMoreAudio = false;
    eutherBooksAudioDurationCache.set(path, decoded.duration);
    target = { index: target.index + 1, offset: 0 };
  }
}

function updateEutherBooksWebAudioPlayback(): void {
  const state = eutherBooksWebAudioState;
  const job = currentEutherBooksPlaybackJob();
  if (!state || !job || state.jobId !== job.id || state.sessionId !== eutherBooksPlaybackSessionCounter || !state.playing) {
    return;
  }
  const timeline = eutherBooksPlaybackTimeline(job, null);
  const current = timeline.current;
  const total = timeline.total;
  maybePrefetchEutherBooksNextChapter();
  updateEutherBooksVirtualPlayerDom(null);
  if (state.waitingForMoreAudio) {
    const buffer = eutherBooksBufferedAutoplayStatus(job, current, false);
    if (!buffer.ready) {
      setEutherBooksPlaybackState("buffering", eutherBooksBufferedAutoplayLabel(job, current, false));
      scheduleEutherBooksJobPoll(250);
      return;
    }
    eutherBooksPendingAutoplayJobId = null;
    eutherBooksBufferedAutoplayJobId = null;
    void startEutherBooksWebAudioPlayback(current);
    return;
  }
  if (
    total > 0
    && job.status !== "done"
    && job.status !== "failed"
    && Math.min(eutherBooksPlayableBufferAhead(job, current), Math.max(0, state.scheduledUntil - current)) <= EUTHERBOOKS_AUTOPLAY_UNDERRUN_GUARD_SECONDS
  ) {
    pauseEutherBooksWebAudioForBuffering(state, job, Math.min(current, total));
    renderBooksWindowIfActive();
    return;
  }
  if (total > 0 && current >= Math.max(0, total - 0.08)) {
    if (job.status !== "done" && job.status !== "failed") {
      pauseEutherBooksWebAudioForBuffering(state, job, total);
      renderBooksWindowIfActive();
      return;
    }
    stopEutherBooksWebAudioPlayback(false);
    eutherBooksAudioIndex = Math.max(0, job.audio_files.length - 1);
    setEutherBooksPlaybackState("ended", "Chapter complete");
    void handleEutherBooksAudioEnded();
    return;
  }
  if (state.scheduledUntil - current < 12) {
    void scheduleEutherBooksWebAudioAhead().catch((err) => {
      if (isEutherBooksAbortError(err)) {
        return;
      }
      stopEutherBooksWebAudioPlayback(true);
      setEutherBooksPlaybackError(err);
      renderBooksWindowIfActive();
    });
  }
}

async function recoverEutherBooksPlaybackAfterPageResume(reason: string): Promise<void> {
  if (eutherBooksSleepTimerDeadline && Date.now() >= eutherBooksSleepTimerDeadline) {
    triggerEutherBooksSleepTimer("page-resume");
    return;
  }
  if (eutherBooksSleepTimerDeadline) {
    scheduleEutherBooksSleepTimer();
  }
  const state = eutherBooksWebAudioState;
  const job = currentEutherBooksPlaybackJob();
  if (!state || !job || state.jobId !== job.id || !state.playing) {
    return;
  }
  if (eutherBooksJob && eutherBooksJob.status !== "done" && eutherBooksJob.status !== "failed") {
    scheduleEutherBooksJobPoll(100);
  }
  if (state.waitingForMoreAudio) {
    updateEutherBooksWebAudioPlayback();
    return;
  }
  if (state.context.state === "suspended") {
    try {
      await state.context.resume();
    } catch (_err) {
      setEutherBooksPlaybackState("paused", "Tap Play to resume audio");
      renderBooksWindowIfActive();
      return;
    }
  }
  const current = eutherBooksWebAudioCurrentTime(job) ?? state.virtualStartedAt;
  const total = eutherBooksVirtualTotalDuration(job);
  if (!state.waitingForMoreAudio && state.sources.size === 0 && current < Math.max(0, total - 0.1)) {
    setEutherBooksPlaybackState("loading", `Resuming after ${reason}`);
    await startEutherBooksWebAudioPlayback(current);
    return;
  }
  state.contextStartedAt = state.context.currentTime - Math.max(0, current - state.virtualStartedAt);
  try {
    await scheduleEutherBooksWebAudioAhead();
  } catch (err) {
    if (!isEutherBooksAbortError(err)) {
      setEutherBooksPlaybackError(err);
      renderBooksWindowIfActive();
    }
    return;
  }
  updateEutherBooksWebAudioPlayback();
}

function eutherBooksVirtualCurrentTime(job: EutherBooksJob | null, audio: HTMLAudioElement | null): number {
  const webAudioCurrent = eutherBooksWebAudioCurrentTime(job);
  if (webAudioCurrent !== null) {
    return webAudioCurrent;
  }
  const current = audio && Number.isFinite(audio.currentTime) ? Math.max(0, audio.currentTime) : 0;
  if (eutherBooksUsesCombinedPlayback(job)) {
    return current;
  }
  const durations = eutherBooksChunkDurations(job);
  const before = durations.slice(0, Math.max(0, eutherBooksAudioIndex)).reduce((sum, duration) => sum + duration, 0);
  return before + current;
}

function eutherBooksVirtualSeekTarget(job: EutherBooksJob | null, seconds: number): { index: number; offset: number } | null {
  const audioFiles = job?.audio_files ?? [];
  if (!audioFiles.length) {
    return null;
  }
  if (eutherBooksUsesCombinedPlayback(job)) {
    return { index: 0, offset: Math.max(0, seconds) };
  }
  const durations = eutherBooksChunkDurations(job);
  let remaining = Math.max(0, seconds);
  for (let index = 0; index < audioFiles.length; index += 1) {
    const duration = durations[index] || (index === audioFiles.length - 1 ? Number.POSITIVE_INFINITY : 0);
    if (remaining <= duration || index === audioFiles.length - 1) {
      return { index, offset: Math.max(0, Math.min(remaining, Number.isFinite(duration) ? Math.max(0, duration - 0.15) : remaining)) };
    }
    remaining -= duration;
  }
  return { index: audioFiles.length - 1, offset: 0 };
}

function seekEutherBooksVirtualTime(seconds: number, autoplay = false): void {
  const job = currentEutherBooksPlaybackJob();
  const target = eutherBooksVirtualSeekTarget(job, seconds);
  if (!target) {
    return;
  }
  if (job && eutherBooksUsesWebAudioPlayback(job)) {
    eutherBooksAudioIndex = target.index;
    if (autoplay || isEutherBooksWebAudioPlaying(job)) {
      void startEutherBooksWebAudioPlayback(seconds);
    } else {
      const state = eutherBooksWebAudioState;
      if (state?.jobId === job.id) {
        state.virtualStartedAt = Math.max(0, seconds);
        state.scheduledUntil = Math.max(0, seconds);
      }
      updateEutherBooksVirtualPlayerDom(null);
      renderBooksWindowIfActive();
    }
    return;
  }
  if (target.index !== eutherBooksAudioIndex) {
    eutherBooksAudioIndex = target.index;
    renderBooksWindowIfActive();
    playEutherBooksAudioSoon(target.offset, autoplay);
    return;
  }
  const audio = currentEutherBooksAudio();
  if (!audio) {
    return;
  }
  const apply = () => {
    audio.currentTime = target.offset;
    updateEutherBooksVirtualPlayerDom(audio);
    if (autoplay) {
      audio.play().catch((err) => {
        setEutherBooksPlaybackError(err);
        renderBooksWindowIfActive();
      });
    }
  };
  if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
    apply();
  } else {
    audio.addEventListener("loadedmetadata", apply, { once: true });
  }
}

function updateEutherBooksVirtualPlayerDom(audio: HTMLAudioElement | null): void {
  const job = currentEutherBooksPlaybackJob();
  const timeline = eutherBooksPlaybackTimeline(job, audio);
  const current = timeline.current;
  const total = timeline.total;
  const range = workspaceWindowDynamic.querySelector<HTMLInputElement>("[data-eutherbooks-virtual-seek]");
  if (range) {
    const max = Math.max(total, current, 0.01);
    range.max = max.toFixed(3);
    range.value = Math.min(current, max).toFixed(3);
  }
  const label = workspaceWindowDynamic.querySelector<HTMLElement>("[data-eutherbooks-virtual-time]");
  if (label) {
    label.textContent = `${formatDuration(current)} / ${total > 0 ? formatDuration(total) : "--:--"}`;
  }
  const toggle = workspaceWindowDynamic.querySelector<HTMLButtonElement>("[data-eutherbooks-web-audio-toggle]");
  if (toggle) {
    toggle.textContent = eutherBooksPlaybackButtonLabel(job);
  }
  const buffer = workspaceWindowDynamic.querySelector<HTMLElement>("[data-eutherbooks-playback-buffer]");
  if (buffer) {
    buffer.outerHTML = eutherBooksPlaybackBufferMarkup(timeline);
  }
}


function currentEutherBooksAudio(): HTMLAudioElement | null {
  return workspaceWindowDynamic.querySelector<HTMLAudioElement>(".eutherbooks-now-playing audio");
}

function retireDetachedEutherBooksAudio(): void {
  for (const audio of workspaceWindowDynamic.querySelectorAll<HTMLAudioElement>(".eutherbooks-now-playing audio")) {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }
}

type EutherBooksAudioRenderState = {
  jobId: string;
  virtualTime: number;
  wasPlaying: boolean;
};

function captureEutherBooksAudioRenderState(): EutherBooksAudioRenderState | null {
  const job = currentEutherBooksPlaybackJob();
  const audio = currentEutherBooksAudio();
  if (!job) {
    return null;
  }
  return {
    jobId: job.id,
    virtualTime: eutherBooksVirtualCurrentTime(job, audio),
    wasPlaying: isEutherBooksWebAudioPlaying(job) || Boolean(audio && !audio.paused && !audio.ended),
  };
}

function restoreEutherBooksAudioRenderState(state: EutherBooksAudioRenderState, renderToken: number): void {
  const job = currentEutherBooksPlaybackJob();
  const audio = currentEutherBooksAudio();
  if (!job || job.id !== state.jobId) {
    return;
  }
  if (eutherBooksUsesWebAudioPlayback(job)) {
    if (eutherBooksWebAudioState?.jobId === job.id) {
      updateEutherBooksVirtualPlayerDom(null);
      return;
    }
    const target = eutherBooksVirtualSeekTarget(job, state.virtualTime);
    eutherBooksAudioIndex = target?.index ?? eutherBooksAudioIndex;
    if (state.wasPlaying) {
      void startEutherBooksWebAudioPlayback(state.virtualTime);
    } else if (eutherBooksWebAudioState?.jobId === job.id) {
      eutherBooksWebAudioState.virtualStartedAt = state.virtualTime;
    }
    updateEutherBooksVirtualPlayerDom(null);
    return;
  }
  if (!audio) {
    return;
  }
  const apply = () => {
    if (renderToken !== eutherBooksAudioRenderToken || currentEutherBooksAudio() !== audio) {
      audio.pause();
      return;
    }
    const target = eutherBooksVirtualSeekTarget(job, state.virtualTime);
    if (target && target.index !== eutherBooksAudioIndex) {
      eutherBooksAudioIndex = target.index;
      renderBooksWindowIfActive();
      playEutherBooksAudioSoon(target.offset, state.wasPlaying);
      return;
    }
    const targetOffset = target?.offset ?? state.virtualTime;
    const maxTime = Number.isFinite(audio.duration) && audio.duration > 0
      ? Math.max(0, audio.duration - 0.1)
      : targetOffset;
    audio.currentTime = Math.min(targetOffset, maxTime);
    updateEutherBooksVirtualPlayerDom(audio);
    if (state.wasPlaying) {
      playEutherBooksAudioElement(audio, renderToken);
    }
  };
  if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
    apply();
  } else {
    audio.addEventListener("loadedmetadata", apply, { once: true });
  }
}

function playEutherBooksAudioElement(audio: HTMLAudioElement, renderToken: number): void {
  setEutherBooksPlaybackState("playing", "Playing generated chapter");
  audio.play().catch((err) => {
    if (renderToken !== eutherBooksAudioRenderToken) {
      return;
    }
    setEutherBooksPlaybackError(err);
    renderBooksWindowIfActive();
  });
}

function currentEutherBooksPlaybackJob(): EutherBooksJob | null {
  if (eutherBooksJob?.audio_files.length) {
    return eutherBooksJob;
  }
  if (eutherBooksJob && eutherBooksJob.status !== "done" && eutherBooksJob.status !== "failed" && !eutherBooksPlayableFallbackJob) {
    return null;
  }
  return eutherBooksPlayableFallbackJob;
}

function isEutherBooksAudioPlaying(): boolean {
  const audio = currentEutherBooksAudio();
  return isEutherBooksWebAudioPlaying() || Boolean(audio && !audio.paused && !audio.ended);
}

function saveEutherBooksBookmark(reason: "pause" | "manual" | "auto"): void {
  const book = selectedEutherBook();
  const playbackJob = currentEutherBooksPlaybackJob();
  const audioFiles = playbackJob?.audio_files ?? [];
  const audioPath = audioFiles[eutherBooksAudioIndex];
  const audio = currentEutherBooksAudio();
  if (!book || !audioPath) {
    return;
  }
  const bookmark: EutherBooksBookmark = {
    book_id: book.id,
    chapter_index: selectedEutherBookChapterIndex,
    audio_index: eutherBooksAudioIndex,
    audio_path: audioPath,
    current_time: eutherBooksVirtualCurrentTime(playbackJob, audio),
    duration: eutherBooksVirtualTotalDuration(playbackJob) || (audio && Number.isFinite(audio.duration) ? Math.max(0, audio.duration) : null),
    updated_at: Date.now(),
  };
  localStorage.setItem(eutherBooksBookmarkKey(book.id), JSON.stringify(bookmark));
  eutherBooksPlayerStatus = reason === "manual" ? `Bookmark saved at ${formatDuration(bookmark.current_time)}` : eutherBooksPlayerStatus;
}

async function resumeEutherBooksBookmark(): Promise<void> {
  const book = selectedEutherBook();
  const bookmark = book ? eutherBooksBookmarkFor(book.id) : null;
  if (!book || !bookmark) {
    return;
  }
  selectedEutherBookChapterIndex = bookmark.chapter_index;
  persistEutherBooksSelectionPreference();
  const bookmarkedJobId = bookmark.audio_path.startsWith("job:") ? bookmark.audio_path.slice(4) : null;
  let job = bookmarkedJobId && eutherBooksJob?.id === bookmarkedJobId
    ? eutherBooksJob
    : !bookmarkedJobId && eutherBooksJob?.audio_files.includes(bookmark.audio_path)
      ? eutherBooksJob
      : null;
  if (!job) {
    try {
      const jobs = await eutherBooksJson<EutherBooksJob[]>("/jobs");
      job = bookmarkedJobId
        ? jobs.find((candidate) => candidate.book_id === book.id && candidate.id === bookmarkedJobId) ?? null
        : jobs
            .filter((candidate) => candidate.book_id === book.id && candidate.audio_files.includes(bookmark.audio_path))
            .sort((left, right) => right.audio_files.length - left.audio_files.length)[0] ?? null;
    } catch (_err) {
      job = null;
    }
  }
  if (!job) {
    setEutherBooksPlaybackState("error", "Bookmarked audio is not available");
    renderBooksWindowIfActive();
    return;
  }
  eutherBooksJob = job;
  eutherBooksPlayableFallbackJob = null;
  eutherBooksAudioIndex = bookmarkedJobId ? 0 : Math.max(0, job.audio_files.indexOf(bookmark.audio_path));
  setEutherBooksPlaybackState("loading", `Resuming ${formatDuration(bookmark.current_time)}`);
  renderBooksWindowIfActive();
  seekEutherBooksVirtualTime(bookmark.current_time, true);
}

async function handleEutherBooksAudioEnded(): Promise<void> {
  saveEutherBooksBookmark("auto");
  const playbackJob = currentEutherBooksPlaybackJob();
  const audioFiles = playbackJob?.audio_files ?? [];
  const combinedPlayback = eutherBooksUsesCombinedPlayback(playbackJob);
  if (!eutherBooksAutoAdvance) {
    setEutherBooksPlaybackState("paused", "Next part is ready");
    renderBooksWindowIfActive();
    return;
  }
  if (!combinedPlayback && eutherBooksAudioIndex + 1 < audioFiles.length) {
    setEutherBooksAudioIndex(eutherBooksAudioIndex + 1, true);
    return;
  }
  if (playbackJob && playbackJob.status !== "done" && playbackJob.status !== "failed") {
    const audio = currentEutherBooksAudio();
    queueEutherBooksBufferedAutoplay(playbackJob, eutherBooksVirtualCurrentTime(playbackJob, audio), false);
    renderBooksWindowIfActive();
    return;
  }
  if (eutherBooksSleepTimerMode === "chapter") {
    await stopEutherBooksAtChapterEnd();
    return;
  }
  if (!eutherBooksAutoGenerateNext) {
    setEutherBooksPlaybackState("ended", "Chapter complete");
    renderBooksWindowIfActive();
    return;
  }
  const nextChapter = nextEutherBookChapter();
  if (!nextChapter) {
    setEutherBooksPlaybackState("ended", "Book complete");
    renderBooksWindowIfActive();
    return;
  }
  const book = selectedEutherBook();
  const prefetchedJob = book
    ? eutherBooksPrefetchJobs.find((job) => eutherBooksPrefetchMatches(book.id, nextChapter.index, job))
    : null;
  if (prefetchedJob) {
    if (prefetchedJob.audio_files.length) {
      switchToEutherBooksPrefetchJob(prefetchedJob, true);
      return;
    }
    eutherBooksPendingAutoplayJobId = prefetchedJob.id;
    setEutherBooksPlaybackState("buffering", "Buffering next chapter");
    scheduleEutherBooksPrefetchPoll();
    renderBooksWindowIfActive();
    return;
  }
  setEutherBooksPlaybackState("loading", `Preparing ${nextChapter.title}`);
  await startEutherBooksTts(nextChapter.index, true);
}

async function stopEutherBooksAtChapterEnd(): Promise<void> {
  clearEutherBooksSleepTimer();
  eutherBooksPendingAutoplayJobId = null;
  eutherBooksBufferedAutoplayJobId = null;
  eutherBooksBufferedResumeSeconds = 0;
  eutherBooksBufferedAudioCount = 0;
  setEutherBooksPlaybackState("ended", nextEutherBookChapter()
    ? "Sleep timer stopped at chapter end"
    : "Sleep timer stopped at book end");
  renderBooksWindowIfActive();
}

function switchToEutherBooksPrefetchJob(job: EutherBooksJob, autoplay: boolean, status?: string): void {
  if (!eutherBooksPrefetchJobs.some((candidate) => candidate.id === job.id)) {
    return;
  }
  eutherBooksJob = job;
  selectedEutherBookChapterIndex = job.chapter_indexes[0] ?? selectedEutherBookChapterIndex;
  persistEutherBooksSelectionPreference();
  eutherBooksAudioIndex = 0;
  eutherBooksPendingAutoplayJobId = null;
  eutherBooksBufferedAutoplayJobId = null;
  eutherBooksPrefetchJobs = eutherBooksPrefetchJobs.filter((candidate) => candidate.id !== job.id);
  clearEutherBooksPrefetchPoll();
  setEutherBooksPlaybackState(job.audio_files.length ? "paused" : "loading", status ?? (job.audio_files.length ? "Next chapter ready" : "Preparing next chapter"));
  renderBooksWindowIfActive();
  if (autoplay) {
    playEutherBooksAudioSoon(0);
  }
}

function nextEutherBookChapter(): EutherBookChapter | null {
  return upcomingEutherBookChapters(1)[0] ?? null;
}

function upcomingEutherBookChapters(count: number): EutherBookChapter[] {
  const currentIndex = selectedEutherBookChapterIndex;
  const currentPosition = selectedEutherBookChapters.findIndex((chapter) => chapter.index === currentIndex);
  if (currentPosition < 0) {
    return [];
  }
  return selectedEutherBookChapters.slice(currentPosition + 1, currentPosition + 1 + count);
}

function setEutherBooksAutoAdvance(value: boolean): void {
  eutherBooksAutoAdvance = value;
  localStorage.setItem("eutherbooks-auto-advance", String(value));
  if (!value) {
    eutherBooksPendingAutoplayJobId = null;
    eutherBooksBufferedAutoplayJobId = null;
  }
  eutherBooksPlayerStatus = value ? "Auto-play enabled" : "Auto-play paused";
  renderBooksWindowIfActive();
}

function setEutherBooksAutoGenerateNext(value: boolean): void {
  eutherBooksAutoGenerateNext = value;
  localStorage.setItem("eutherbooks-auto-generate-next", String(value));
  scheduleUserPreferencesSave();
  eutherBooksPlayerStatus = value ? "Auto-generate enabled" : "Auto-generate paused";
  renderBooksWindowIfActive();
  if (value) {
    void ensureEutherBooksNextChapterPrefetched();
  }
}

function setEutherBooksSleepTimer(value: string): void {
  const nextMode = parseEutherBooksSleepTimerMode(value);
  clearEutherBooksSleepTimer();
  eutherBooksSleepTimerMode = nextMode;
  if (nextMode === "off") {
    eutherBooksPlayerStatus = "Sleep timer off";
    renderBooksWindowIfActive();
    return;
  }
  if (nextMode === "chapter") {
    eutherBooksPlayerStatus = "Sleep timer will stop after this chapter";
    renderBooksWindowIfActive();
    return;
  }
  eutherBooksSleepTimerDeadline = Date.now() + Number(nextMode) * 60 * 1000;
  scheduleEutherBooksSleepTimer();
  eutherBooksPlayerStatus = `Sleep timer set for ${nextMode} minutes`;
  renderBooksWindowIfActive();
}

function parseEutherBooksSleepTimerMode(value: string): EutherBooksSleepTimerMode {
  return value === "5" || value === "10" || value === "15" || value === "30" || value === "45" || value === "60" || value === "chapter"
    ? value
    : "off";
}

function clearEutherBooksSleepTimer(): void {
  if (eutherBooksSleepTimerId !== null) {
    window.clearTimeout(eutherBooksSleepTimerId);
    eutherBooksSleepTimerId = null;
  }
  eutherBooksSleepTimerMode = "off";
  eutherBooksSleepTimerDeadline = null;
}

function scheduleEutherBooksSleepTimer(): void {
  if (eutherBooksSleepTimerId !== null) {
    window.clearTimeout(eutherBooksSleepTimerId);
    eutherBooksSleepTimerId = null;
  }
  if (!eutherBooksSleepTimerDeadline) {
    return;
  }
  const delay = Math.max(0, eutherBooksSleepTimerDeadline - Date.now());
  eutherBooksSleepTimerId = window.setTimeout(() => {
    eutherBooksSleepTimerId = null;
    triggerEutherBooksSleepTimer();
  }, delay);
}

function pauseEutherBooksPlaybackForSleepTimer(): void {
  const audio = currentEutherBooksAudio();
  if (isEutherBooksWebAudioPlaying()) {
    stopEutherBooksWebAudioPlayback(true);
    saveEutherBooksBookmark("pause");
  } else if (audio && !audio.paused && !audio.ended) {
    audio.pause();
    saveEutherBooksBookmark("pause");
  }
  eutherBooksPendingAutoplayJobId = null;
  eutherBooksBufferedAutoplayJobId = null;
  eutherBooksBufferedResumeSeconds = 0;
  eutherBooksBufferedAudioCount = 0;
}

function triggerEutherBooksSleepTimer(reason = "timer"): void {
  clearEutherBooksSleepTimer();
  pauseEutherBooksPlaybackForSleepTimer();
  setEutherBooksPlaybackState("paused", reason === "page-resume" ? "Sleep timer paused while screen was off" : "Sleep timer paused playback");
  renderBooksWindowIfActive();
}

function eutherBooksSleepTimerLabel(): string {
  if (eutherBooksSleepTimerMode === "chapter") {
    return "Stops playback when this chapter finishes.";
  }
  if (eutherBooksSleepTimerMode === "off" || !eutherBooksSleepTimerDeadline) {
    return "Timer is off.";
  }
  const remainingMs = Math.max(0, eutherBooksSleepTimerDeadline - Date.now());
  const remainingMinutes = Math.max(1, Math.ceil(remainingMs / 60000));
  return `Pauses playback in ${remainingMinutes} min.`;
}

function eutherBooksPlaybackLabel(): string {
  const playbackJob = currentEutherBooksPlaybackJob();
  if (playbackJob?.audio_files.length) {
    const total = Math.max(playbackJob.total_audio_files ?? 0, playbackJob.audio_files.length);
    if (eutherBooksUsesWebAudioPlayback(playbackJob)) {
      const timeline = eutherBooksPlaybackTimeline(playbackJob, null);
      const readyLabel = playbackJob.status === "done" || playbackJob.status === "failed"
        ? "Chapter ready"
        : "Chapter buffering";
      return `${readyLabel}: ${formatDuration(timeline.generatedUntil)} generated (${playbackJob.audio_files.length}/${total} parts)`;
    }
    return `Ready: ${eutherBooksAudioIndex + 1}/${playbackJob.audio_files.length} (${total} generated)`;
  }
  if (!eutherBooksJob) {
    return selectedEutherBookChapters.length ? "Generate a chapter to listen" : "Select a book";
  }
  if (eutherBooksJob.status === "failed") {
    return "Speech generation failed";
  }
  if (eutherBooksJob.audio_files.length) {
    const total = Math.max(eutherBooksJob.total_audio_files ?? 0, eutherBooksJob.total_chunks ?? 0, eutherBooksJob.audio_files.length);
    return `Backend is working: ${eutherBooksJob.audio_files.length}/${total} parts rendered`;
  }
  if (eutherBooksJob.status === "queued") {
    return "Speech generation queued";
  }
  return "Speech generation running";
}

function eutherBooksJobProgress(): { done: number; total: number; percent: number; label: string } {
  if (!eutherBooksJob) {
    return { done: 0, total: 0, percent: 0, label: "Generation idle" };
  }
  const baseDone = Math.max(eutherBooksJob.audio_files.length, eutherBooksJob.current_chunk_index ?? 0);
  const workerProgress = eutherBooksJob.status === "running"
    ? Math.min(0.99, Math.max(0, eutherBooksJob.worker_progress ?? 0))
    : 0;
  const total = Math.max(
    eutherBooksJob.total_chunks ?? 0,
    eutherBooksJob.total_audio_files ?? 0,
    eutherBooksJob.audio_files.length,
    eutherBooksJob.status === "done" ? baseDone : 1,
  );
  const done = Math.min(total, baseDone + workerProgress);
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const labelPrefix = eutherBooksJob.progress_label?.trim()
    || (eutherBooksJob.status === "done"
      ? "Ready"
      : eutherBooksJob.status === "failed"
        ? "Failed"
        : eutherBooksJob.status === "queued"
          ? "Queued"
          : "Generating");
  const doneLabel = Number.isInteger(done) ? String(done) : done.toFixed(1);
  const label = `${labelPrefix} ${doneLabel}/${total}`;
  return { done, total, percent, label };
}

function eutherBooksBackendPulse(): { title: string; detail: string } {
  if (!eutherBooksJob) {
    return { title: "Backend idle", detail: "No speech job is attached to this chapter." };
  }
  const total = Math.max(eutherBooksJob.total_chunks ?? 0, eutherBooksJob.total_audio_files ?? 0, eutherBooksJob.audio_files.length);
  const done = Math.max(eutherBooksJob.current_chunk_index ?? 0, eutherBooksJob.audio_files.length);
  const checked = eutherBooksJobLastCheckedAt ? new Date(eutherBooksJobLastCheckedAt).toLocaleTimeString() : "not checked";
  if (eutherBooksJob.status === "done") {
    return { title: "Backend ready", detail: `${eutherBooksJob.audio_files.length} audio parts ready. Last checked ${checked}.` };
  }
  if (eutherBooksJob.status === "failed") {
    return { title: "Backend failed", detail: eutherBooksFriendlyError(eutherBooksJob.error ?? "Speech generation failed.") };
  }
  return {
    title: eutherBooksJob.status === "queued" ? "Backend queued" : "Backend running",
    detail: total > 0 ? `${done}/${total} parts rendered. Last checked ${checked}.` : `Last checked ${checked}.`,
  };
}

function eutherBooksAudioWaitingLabel(): string {
  if (!eutherBooksJob) {
    return "Generate speech to create audio.";
  }
  if (eutherBooksJob.status === "failed") {
    return "Audio was not created because generation failed.";
  }
  if (eutherBooksJob.status === "done") {
    return "No audio file is available for this job.";
  }
  return "Player starts when enough audio is buffered.";
}

function setEutherBooksOption(key: string, value: number): void {
  const safeValue = clampEutherBooksOption(key, value);
  switch (key) {
    case "length_scale":
      eutherBooksLengthScale = safeValue;
      break;
    case "noise_scale":
      eutherBooksNoiseScale = safeValue;
      break;
    case "noise_w":
      eutherBooksNoiseW = safeValue;
      break;
    case "sentence_silence":
      eutherBooksSentenceSilence = safeValue;
      break;
    case "cfg_value":
      eutherBooksCfgValue = safeValue;
      break;
    case "inference_timesteps":
      eutherBooksInferenceTimesteps = safeValue;
      break;
    case "dots_guidance_scale":
    case "dots_speaker_scale":
    case "dots_num_steps":
      return;
    case "dots_max_generate_length":
      return;
    case "max_chunk_chars":
      eutherBooksMaxChunkChars = safeValue;
      break;
    case "seed":
      eutherBooksSeed = safeValue;
      break;
    default:
      return;
  }
  resetEutherBooksSelectionAudio();
  localStorage.setItem(`eutherbooks-${key}`, String(safeValue));
  scheduleUserPreferencesSave();
  renderBooksWindowIfActive();
}

function storedEutherBooksNumber(key: string, fallback: number): number {
  const value = Number(localStorage.getItem(`eutherbooks-${key}`));
  return Number.isFinite(value) ? clampEutherBooksOption(key, value) : fallback;
}

function clampEutherBooksOption(key: string, value: number): number {
  if (!Number.isFinite(value)) {
    return eutherBooksOptionFallback(key);
  }
  switch (key) {
    case "length_scale":
      return Math.min(Math.max(value, 0.75), 1.35);
    case "noise_scale":
      return Math.min(Math.max(value, 0.2), 1);
    case "noise_w":
      return Math.min(Math.max(value, 0.2), 1.2);
    case "sentence_silence":
      return Math.min(Math.max(value, 0), 0.8);
    case "cfg_value":
      return Math.min(Math.max(value, 1), 3);
    case "inference_timesteps":
      return Math.round(Math.min(Math.max(value, 10), 50));
    case "dots_guidance_scale":
      return Math.min(Math.max(value, 0), 5);
    case "dots_speaker_scale":
      return Math.min(Math.max(value, 0), 5);
    case "dots_num_steps":
      return Math.round(Math.min(Math.max(value, 1), 50));
    case "dots_max_generate_length":
      return eutherBooksDotsMaxGenerateLength;
    case "max_chunk_chars":
      return Math.round(Math.min(Math.max(value, 120), 1500));
    case "seed":
      return Math.round(Math.min(Math.max(value, 0), 2147483647));
    default:
      return value;
  }
}

function eutherBooksOptionFallback(key: string): number {
  switch (key) {
    case "length_scale":
      return 1;
    case "noise_scale":
      return 0.667;
    case "noise_w":
      return 0.8;
    case "sentence_silence":
      return 0.2;
    case "cfg_value":
      return 2;
    case "inference_timesteps":
      return 10;
    case "dots_guidance_scale":
      return 1.2;
    case "dots_speaker_scale":
      return 1.5;
    case "dots_num_steps":
      return 10;
    case "dots_max_generate_length":
      return eutherBooksDotsMaxGenerateLength;
    case "max_chunk_chars":
      return 700;
    case "seed":
      return 0;
    default:
      return 0;
  }
}

function eutherBooksPlayerHint(): string {
  if (!eutherBooks.length) {
    return "Start the EutherBooks service and add books to its library directory.";
  }
  if (!selectedEutherBookChapters.length) {
    return selectedEutherBookChaptersLoading ? "Reading chapter list." : "No readable chapters found.";
  }
  return "Generate speech for the selected chapter, then use the player controls.";
}

function setEutherBooksAudioIndex(index: number, autoplay = false): void {
  const audioFiles = currentEutherBooksPlaybackJob()?.audio_files ?? [];
  if (!audioFiles.length) {
    return;
  }
  const nextIndex = Math.max(0, Math.min(index, audioFiles.length - 1));
  if (nextIndex === eutherBooksAudioIndex && !autoplay) {
    return;
  }
  stopEutherBooksWebAudioPlayback(false);
  eutherBooksAudioIndex = nextIndex;
  renderBooksWindowIfActive();
  if (autoplay && currentEutherBooksAudio()) {
    playEutherBooksAudioSoon(0);
  } else if (autoplay) {
    playEutherBooksAudioSoon(0);
  }
}

function playEutherBooksAudioSoon(startTime = 0, autoplay = true): void {
  const job = currentEutherBooksPlaybackJob();
  if (eutherBooksUsesWebAudioPlayback(job)) {
    if (autoplay) {
      void startEutherBooksWebAudioPlayback(eutherBooksChunkStartTime(job, eutherBooksAudioIndex) + Math.max(0, startTime));
    } else {
      updateEutherBooksVirtualPlayerDom(null);
    }
    return;
  }
  const renderToken = eutherBooksAudioRenderToken;
  window.setTimeout(() => {
    if (renderToken !== eutherBooksAudioRenderToken) {
      return;
    }
    const audio = currentEutherBooksAudio();
    if (!audio) {
      return;
    }
    if (startTime > 0) {
      const applyStartTime = () => {
        audio.currentTime = Math.min(startTime, Number.isFinite(audio.duration) ? Math.max(0, audio.duration - 0.25) : startTime);
      };
      if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
        applyStartTime();
      } else {
        audio.addEventListener("loadedmetadata", applyStartTime, { once: true });
      }
    }
    updateEutherBooksVirtualPlayerDom(audio);
    if (!autoplay) {
      return;
    }
    audio.play().catch((err) => {
      if (renderToken !== eutherBooksAudioRenderToken) {
        return;
      }
      setEutherBooksPlaybackError(err);
      renderBooksWindowIfActive();
    });
  }, 0);
}

function renderBooksWindowIfActive(): void {
  if (activeWorkspaceWindow === "books") {
    renderWorkspaceWindow();
  }
}

function renderBooksWindowIfActiveUnlessEutherBooksAudioPlaying(): void {
  if (!isEutherBooksAudioPlaying()) {
    renderBooksWindowIfActive();
  }
}

function formatDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function eutheriumAwardPanelMarkup(): string {
  const candidates = visibleInteractionFriends().filter((friend) => !friend.isCurrentUser || hostIsAdmin);
  const options = candidates.length
    ? candidates.map((friend) => `<option value="${escapeHtml(friend.name)}">${escapeHtml(displayUserName(friend.name))}</option>`).join("")
    : `<option value="">No users loaded</option>`;
  return `
    <section class="eutherium-award-panel">
      <div class="section-head">
        <div>
          <p class="section-label">Eutherium Dispenser</p>
          <strong>Manual award</strong>
        </div>
        <span>${hostIsAdmin ? "Admin unlimited" : "Subadmin 3000 / 10000 daily"}</span>
      </div>
      <div class="eutherium-award-form">
        <select id="eutherium-award-user" aria-label="award user">${options}</select>
        <input id="eutherium-award-amount" type="number" min="1" step="1" value="100" aria-label="award amount" />
        <input id="eutherium-award-reason" type="text" placeholder="reason" aria-label="award reason" />
        <button data-eutherium-award-submit type="button">Award</button>
      </div>
    </section>
  `;
}

function trophyRoomMarkup(data: EutheriumMeResult): string {
  return `
    <div class="trophy-room trophy-bg-${escapeHtml(data.trophyRoom.layout.background)}">
      ${trophyRoomItemsMarkup(data)}
    </div>
  `;
}

function trophyRoomItemsMarkup(data: EutheriumMeResult): string {
  const inventory = new Map(data.inventory.map((entry) => [entry.id, entry]));
  return data.trophyRoom.layout.items
    .map((placed) => {
      const entry = inventory.get(placed.inventoryId);
      const item = entry?.item;
      if (!entry || !item) {
        return "";
      }
      const selected = selectedTrophyInventoryId === entry.id;
      return `
        <button
          class="trophy-room-item ${selected ? "is-selected" : ""}"
          data-trophy-select="${escapeHtml(entry.id)}"
          type="button"
          style="left:${placed.x}%; top:${placed.y}%; --trophy-scale:${placed.scale};"
          aria-label="${escapeHtml(item.name)}"
        >
          <img src="${escapeHtml(eutheriumItemIconUrl(item))}" alt="" />
        </button>
      `;
    })
    .join("");
}

function trophyControlsMarkup(): string {
  if (!selectedTrophyInventoryId) {
    return `<div class="trophy-controls"><span>Select a placed trophy to move it</span></div>`;
  }
  return `
    <div class="trophy-controls">
      <span>Selected trophy</span>
      <button data-trophy-move="up" type="button">Up</button>
      <button data-trophy-move="left" type="button">Left</button>
      <button data-trophy-move="right" type="button">Right</button>
      <button data-trophy-move="down" type="button">Down</button>
      <button data-trophy-move="smaller" type="button">Smaller</button>
      <button data-trophy-move="larger" type="button">Larger</button>
      <button data-trophy-move="remove" type="button">Remove</button>
    </div>
  `;
}

function trophyPreviewMarkup(data: EutheriumMeResult): string {
  const selected = selectedTrophyEntry(data);
  const item = selected?.item;
  if (!selected || !item) {
    return `
      <div class="trophy-preview">
        <div class="trophy-preview-empty">
          <strong>No trophy selected</strong>
          <span>Place an inventory item, then drag it around the room.</span>
        </div>
      </div>
    `;
  }
  return `
    <div class="trophy-preview">
      <div class="trophy-preview-orbit">
        <img src="${escapeHtml(eutheriumItemIconUrl(item))}" alt="" />
      </div>
      <div class="trophy-preview-meta">
        <span>${escapeHtml(item.rarity)}</span>
        <strong>${escapeHtml(item.name)}</strong>
        <p>${escapeHtml(item.description)}</p>
      </div>
    </div>
  `;
}

function shopItemMarkup(item: EutheriumShopItem, balance: number): string {
  const affordable = balance >= item.price;
  return `
    <article class="eutherium-item-card rarity-${escapeHtml(item.rarity.replaceAll(" ", "-"))}">
      <img src="${escapeHtml(eutheriumItemIconUrl(item))}" alt="" />
      <div>
        <span>${escapeHtml(item.rarity)}</span>
        <strong>${escapeHtml(item.name)}</strong>
        <p>${escapeHtml(item.description)}</p>
      </div>
      <button data-eutherium-buy="${escapeHtml(item.id)}" type="button" ${affordable ? "" : "disabled"}>
        ${formatEutherium(item.price)} EUX
      </button>
    </article>
  `;
}

function inventoryItemMarkup(entry: EutheriumInventoryEntry, layout: TrophyRoomLayout): string {
  const item = entry.item;
  const placed = layout.items.some((placedItem) => placedItem.inventoryId === entry.id);
  return `
    <article class="eutherium-inventory-card ${selectedTrophyInventoryId === entry.id ? "is-selected" : ""}">
      ${item ? `<img src="${escapeHtml(eutheriumItemIconUrl(item))}" alt="" />` : ""}
      <div>
        <strong>${escapeHtml(item?.name ?? entry.itemId)}</strong>
        <span>${placed ? "Placed in room" : "In inventory"}</span>
      </div>
      <button data-trophy-place="${escapeHtml(entry.id)}" type="button" ${placed ? "disabled" : ""}>Place</button>
    </article>
  `;
}

function ledgerEntryMarkup(entry: EutheriumLedgerEntry): string {
  const positive = entry.amount >= 0;
  const creator = entry.createdByUserId ? ` by ${displayUserName(entry.createdByUserId)}` : "";
  return `
    <div class="eutherium-ledger-entry ${positive ? "is-positive" : "is-negative"}">
      <strong>${positive ? "+" : ""}${formatEutherium(entry.amount)} EUX</strong>
      <span>${escapeHtml(entry.reason)}${escapeHtml(creator)}</span>
      <em>${escapeHtml(entry.source)}</em>
    </div>
  `;
}

async function loadEutherium(force = false): Promise<void> {
  if ((eutheriumLoaded && !force) || eutheriumSaving) {
    return;
  }
  if (!hostUsername) {
    eutheriumStatus = "Login required";
    eutheriumMe = null;
    renderWorkspaceWindow();
    return;
  }
  eutheriumStatus = "Loading";
  try {
    eutheriumMe = await bridgeJson<EutheriumMeResult>("/api/eutherium/me", {}, 1200);
    eutheriumLoaded = true;
    eutheriumStatus = "Synced";
    if (!selectedTrophyInventoryId && eutheriumMe.trophyRoom.layout.items[0]) {
      selectedTrophyInventoryId = eutheriumMe.trophyRoom.layout.items[0].inventoryId;
    }
  } catch (err) {
    eutheriumLoaded = false;
    eutheriumStatus = err instanceof Error ? err.message : "Sync failed";
  }
  if (activeWorkspaceWindow === "eutherium") {
    renderWorkspaceWindow();
  }
}

async function loadEutheriumLobby(force = false): Promise<void> {
  if (isTauri || !hostUsername) {
    eutheriumLobbyStatus = hostUsername ? "Unavailable" : "Login required";
    renderEutheriumLobby();
    return;
  }
  if (eutheriumLobbyBalance !== null && !force) {
    renderEutheriumLobby();
    return;
  }
  eutheriumLobbyStatus = "Loading";
  renderEutheriumLobby();
  try {
    const result = await bridgeJson<EutheriumActivityResult>("/api/eutherium/activity", {}, 1000);
    eutheriumLobbyBalance = result.balance;
    eutheriumLobbyAwards = result.awards;
    eutheriumLobbyStatus = "Synced";
  } catch (err) {
    eutheriumLobbyStatus = err instanceof Error ? err.message : "Sync failed";
  }
  renderEutheriumLobby();
}

function renderEutheriumLobby(): void {
  eutheriumLobbyStatusEl.textContent = eutheriumLobbyStatus;
  eutheriumLobbyBalanceEl.textContent =
    eutheriumLobbyBalance === null ? "-- EUX" : `${formatEutherium(eutheriumLobbyBalance)} EUX`;
  eutheriumLobbyFeedEl.innerHTML = eutheriumLobbyAwards.length
    ? eutheriumLobbyAwards.map(eutheriumLobbyAwardMarkup).join("")
    : `<span>No recent awards</span>`;
  eutheriumLobbyAwardEl.innerHTML = hostPermissions.canAwardEutherium
    ? eutheriumLobbyAwardPanelMarkup()
    : "";
}

function eutheriumLobbyAwardPanelMarkup(): string {
  const candidates = visibleInteractionFriends().filter((friend) => !friend.isCurrentUser || hostIsAdmin);
  const options = candidates.length
    ? candidates.map((friend) => `<option value="${escapeHtml(friend.name)}">${escapeHtml(displayUserName(friend.name))}</option>`).join("")
    : `<option value="">No users loaded</option>`;
  return `
    <div class="eutherium-lobby-award-form">
      <select id="eutherium-lobby-award-user" aria-label="award user">${options}</select>
      <input id="eutherium-lobby-award-amount" type="number" min="1" step="1" value="100" aria-label="award amount" />
      <input id="eutherium-lobby-award-reason" type="text" placeholder="reason" aria-label="award reason" />
      <button data-eutherium-lobby-award-submit type="button">Award</button>
    </div>
  `;
}

function eutheriumLobbyAwardMarkup(entry: EutheriumLedgerEntry): string {
  const from = entry.createdByUserId ? displayUserName(entry.createdByUserId) : "System";
  return `
    <div class="eutherium-lobby-award-row">
      <strong>+${formatEutherium(entry.amount)} EUX</strong>
      <span>${escapeHtml(from)} gave ${escapeHtml(displayUserName(entry.userId))}</span>
      <em>${escapeHtml(entry.reason)}</em>
    </div>
  `;
}

async function buyEutheriumItem(itemId: string): Promise<void> {
  if (!itemId) {
    return;
  }
  eutheriumSaving = true;
  eutheriumStatus = "Buying";
  renderWorkspaceWindow();
  try {
    eutheriumMe = await bridgeJson<EutheriumMeResult>(
      "/api/shop/buy",
      { method: "POST", body: JSON.stringify({ itemId }) },
      1400,
    );
    eutheriumLoaded = true;
    eutheriumStatus = "Bought";
  } catch (err) {
    eutheriumStatus = err instanceof Error ? err.message : "Buy failed";
  } finally {
    eutheriumSaving = false;
    renderWorkspaceWindow();
  }
}

async function placeTrophyItem(inventoryId: string): Promise<void> {
  if (!eutheriumMe || !inventoryId) {
    return;
  }
  const layout = cloneTrophyLayout(eutheriumMe.trophyRoom.layout);
  if (!layout.items.some((item) => item.inventoryId === inventoryId)) {
    const offset = layout.items.length % 5;
    layout.items.push({ inventoryId, x: 22 + offset * 14, y: 54 + (layout.items.length % 2) * 16, scale: 1 });
  }
  selectedTrophyInventoryId = inventoryId;
  await saveTrophyLayout(layout);
}

function startTrophyDrag(event: PointerEvent, button: HTMLButtonElement): void {
  if (!eutheriumMe || eutheriumSaving) {
    return;
  }
  const inventoryId = button.dataset.trophySelect ?? "";
  const item = eutheriumMe.trophyRoom.layout.items.find((candidate) => candidate.inventoryId === inventoryId);
  if (!inventoryId || !item) {
    return;
  }
  selectedTrophyInventoryId = inventoryId;
  trophyDrag = {
    inventoryId,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    startItemX: item.x,
    startItemY: item.y,
    layout: cloneTrophyLayout(eutheriumMe.trophyRoom.layout),
  };
  button.setPointerCapture(event.pointerId);
  event.preventDefault();
  renderWorkspaceWindow();
}

function updateTrophyDrag(event: PointerEvent): void {
  if (!trophyDrag || !eutheriumMe || event.pointerId !== trophyDrag.pointerId) {
    return;
  }
  const room = workspaceWindowDynamic.querySelector<HTMLElement>(".trophy-room");
  if (!room) {
    return;
  }
  const rect = room.getBoundingClientRect();
  const item = trophyDrag.layout.items.find((candidate) => candidate.inventoryId === trophyDrag?.inventoryId);
  if (!item || rect.width <= 0 || rect.height <= 0) {
    return;
  }
  const deltaX = ((event.clientX - trophyDrag.startX) / rect.width) * 100;
  const deltaY = ((event.clientY - trophyDrag.startY) / rect.height) * 100;
  item.x = clampTrophyPercent(trophyDrag.startItemX + deltaX);
  item.y = clampTrophyPercent(trophyDrag.startItemY + deltaY);
  eutheriumMe = {
    ...eutheriumMe,
    trophyRoom: {
      ...eutheriumMe.trophyRoom,
      layout: cloneTrophyLayout(trophyDrag.layout),
    },
  };
  renderTrophyRoomLive();
  event.preventDefault();
}

async function finishTrophyDrag(event: PointerEvent): Promise<void> {
  if (!trophyDrag || event.pointerId !== trophyDrag.pointerId) {
    return;
  }
  const layout = cloneTrophyLayout(trophyDrag.layout);
  trophyDrag = null;
  event.preventDefault();
  await saveTrophyLayout(layout);
}

function renderTrophyRoomLive(): void {
  if (!eutheriumMe || activeWorkspaceWindow !== "eutherium") {
    return;
  }
  const room = workspaceWindowDynamic.querySelector<HTMLElement>(".trophy-room");
  if (!room) {
    return;
  }
  room.innerHTML = trophyRoomItemsMarkup(eutheriumMe);
}

async function moveSelectedTrophy(action: string): Promise<void> {
  if (!eutheriumMe || !selectedTrophyInventoryId) {
    return;
  }
  const layout = cloneTrophyLayout(eutheriumMe.trophyRoom.layout);
  const item = layout.items.find((candidate) => candidate.inventoryId === selectedTrophyInventoryId);
  if (!item) {
    return;
  }
  switch (action) {
    case "up":
      item.y -= 5;
      break;
    case "down":
      item.y += 5;
      break;
    case "left":
      item.x -= 5;
      break;
    case "right":
      item.x += 5;
      break;
    case "smaller":
      item.scale -= 0.1;
      break;
    case "larger":
      item.scale += 0.1;
      break;
    case "remove":
      layout.items = layout.items.filter((candidate) => candidate.inventoryId !== selectedTrophyInventoryId);
      selectedTrophyInventoryId = null;
      break;
  }
  layout.items = layout.items.map((candidate) => ({
    ...candidate,
    x: clampTrophyPercent(candidate.x),
    y: clampTrophyPercent(candidate.y),
    scale: Math.max(0.4, Math.min(2.2, candidate.scale)),
  }));
  await saveTrophyLayout(layout);
}

async function saveTrophyLayout(layout: TrophyRoomLayout): Promise<void> {
  eutheriumSaving = true;
  eutheriumStatus = "Saving room";
  renderWorkspaceWindow();
  try {
    const result = await bridgeJson<TrophyRoomResult>(
      "/api/trophy-room/layout",
      { method: "POST", body: JSON.stringify({ layout }) },
      1400,
    );
    if (eutheriumMe) {
      eutheriumMe = { ...eutheriumMe, trophyRoom: result };
    }
    eutheriumStatus = "Room saved";
  } catch (err) {
    eutheriumStatus = err instanceof Error ? err.message : "Room save failed";
  } finally {
    eutheriumSaving = false;
    renderWorkspaceWindow();
  }
}

function cloneTrophyLayout(layout: TrophyRoomLayout): TrophyRoomLayout {
  return {
    background: layout.background,
    items: layout.items.map((item) => ({ ...item })),
  };
}

function selectedTrophyEntry(data: EutheriumMeResult): EutheriumInventoryEntry | null {
  if (!selectedTrophyInventoryId) {
    return null;
  }
  return data.inventory.find((entry) => entry.id === selectedTrophyInventoryId) ?? null;
}

function clampTrophyPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function formatEutherium(value: number): string {
  return new Intl.NumberFormat("sv-SE").format(value);
}

function eutheriumItemIconUrl(item: EutheriumShopItem): string {
  const match = Object.entries(eutheriumIconModules).find(([path]) => path.endsWith(`/${item.id}.png`));
  return match?.[1] ?? item.imagePath;
}

function isEutheriumAdminResult(value: unknown): value is EutheriumAdminResult {
  return Boolean(value && typeof value === "object" && Array.isArray((value as EutheriumAdminResult).users));
}

function interactionDeskWindowMarkup(): string {
  const friends = visibleInteractionFriends();
  const onlineCount = friends.filter((friend) => friend.status === "Online").length;
  const hasActiveSocialChat = Boolean(socialChatSelectedConversation());
  return `
    <div class="social-chat-shell ${socialChatSidebarCollapsed ? "is-sidebar-collapsed" : ""} ${hasActiveSocialChat ? "has-active-chat" : ""}">
      <aside class="social-chat-sidebar">
        <div class="section-head">
          <div>
            <p class="section-label">Social Chat</p>
            <strong>${socialChatConversations.length} conversations</strong>
          </div>
          <div class="social-sidebar-actions">
            <button data-social-sidebar-toggle class="mini-action" type="button">${socialChatSidebarCollapsed ? "Open" : "Hide"}</button>
            <button data-social-chat-refresh class="mini-action" type="button">Sync</button>
          </div>
        </div>
        <div class="social-conversation-list">
          ${socialChatConversationListMarkup()}
        </div>
        <div class="social-new-chat">
          <div class="section-head">
            <p class="section-label">New Chat</p>
            <span>${socialChatUsers.length} users</span>
          </div>
          <input
            data-social-user-search
            type="search"
            value="${escapeHtml(socialChatSearchQuery)}"
            placeholder="Search all users"
            aria-label="search users"
            autocomplete="off"
          />
          <div class="social-user-results">
            ${socialChatUserResultsMarkup()}
          </div>
          <button data-social-create-chat type="button" ${socialChatSelectedUsers.size === 0 ? "disabled" : ""}>
            Start ${socialChatSelectedUsers.size > 1 ? "group chat" : "private chat"}
          </button>
        </div>
      </aside>
      <section class="social-chat-thread">
        ${socialChatThreadMarkup()}
      </section>
    </div>
    <div class="workspace-window-grid social-chat-tool-grid">
      <button class="workspace-tool-card" data-workspace-window="friends" type="button">
        <span>${onlineCount} online</span>
        <strong>Friends</strong>
        <small>See real host users and who is available.</small>
      </button>
      <button class="workspace-tool-card" data-workspace-window="spaces" type="button">
        <span>${interactionSpaces.length} spaces</span>
        <strong>Shared Spaces</strong>
        <small>Homes, projects, notes and future vaults.</small>
      </button>
      <button class="workspace-tool-card" data-workspace-window="shopping" type="button">
        <span>Shared markdown</span>
        <strong>Shopping List</strong>
        <small>Open the synced house list in its own editing window.</small>
      </button>
    </div>
  `;
}

function socialChatConversationListMarkup(): string {
  if (socialChatLoading && socialChatConversations.length === 0) {
    return `<span class="workspace-empty">Loading conversations</span>`;
  }
  if (socialChatConversations.length === 0) {
    return `<span class="workspace-empty">No social chats yet</span>`;
  }
  return socialChatConversations
    .map((conversation) => {
      const selected = conversation.id === socialChatSelectedConversationId;
      const preview = conversation.lastMessage
        ? `${displayUserName(conversation.lastMessage.user)}: ${conversation.lastMessage.text}`
        : "No messages yet";
      return `
        <button
          class="social-conversation-row ${selected ? "is-selected" : ""}"
          data-social-conversation="${escapeHtml(conversation.id)}"
          type="button"
        >
          <strong>${escapeHtml(socialChatConversationTitle(conversation))}</strong>
          <span>${escapeHtml(preview)}</span>
        </button>
      `;
    })
    .join("");
}

function socialChatUserResultsMarkup(): string {
  if (socialChatUsers.length === 0) {
    return `<span class="workspace-empty">${socialChatSearchQuery.trim() ? "No users found" : "Search all host users"}</span>`;
  }
  return socialChatUsers
    .map((user) => {
      const selected = socialChatSelectedUsers.has(user.name);
      const status = user.special === "codex" ? user.location : user.online ? user.location : "Offline";
      return `
        <button class="social-user-row ${selected ? "is-selected" : ""} ${user.special === "codex" ? "is-special" : ""}" data-social-user="${escapeHtml(user.name)}" type="button">
          <span class="user-presence-dot ${user.online ? "" : "is-offline"}"></span>
          <strong>${escapeHtml(user.displayName || displayUserName(user.name))}</strong>
          <small>${escapeHtml(status)}</small>
        </button>
      `;
    })
    .join("");
}

function socialChatThreadMarkup(): string {
  const conversation = socialChatSelectedConversation();
  if (!conversation) {
    return `
      <div class="social-chat-empty">
        <p class="section-label">Thread</p>
        <strong>Select or start a chat</strong>
        <span>${escapeHtml(socialChatStatus)}</span>
      </div>
    `;
  }
  const codexInbox = conversation.participants.includes("codex");
  return `
    <div class="social-thread-head ${socialChatThreadDetailsExpanded ? "is-expanded" : ""}">
      <div>
        <p class="section-label">${conversation.kind === "group" ? "Group Chat" : "Private Chat"}</p>
        <strong>${escapeHtml(socialChatConversationTitle(conversation))}</strong>
        <div class="social-thread-extra">
          <span>${conversation.participants.map((participant) => escapeHtml(displayUserName(participant))).join(", ")}</span>
          ${codexInbox ? `<small>Files sent here are copied to .euther-host/codex-inbox for the next Codex session.</small>` : ""}
        </div>
      </div>
      <div class="social-thread-controls">
        <button data-social-thread-details class="mini-action" type="button">${socialChatThreadDetailsExpanded ? "Less" : "Info"}</button>
        <button data-social-back-to-list class="mini-action" type="button">Chats</button>
        <em>${escapeHtml(socialChatStatus)}</em>
      </div>
    </div>
    <div class="social-message-list">
      ${socialChatHasOlder ? `<button data-social-load-older class="mini-action" type="button">Older</button>` : ""}
      ${
        socialChatMessages.length
          ? socialChatMessages.map((message) => socialChatMessageMarkup(message)).join("")
          : `<span class="workspace-empty">No messages yet</span>`
      }
    </div>
    <form class="social-chat-form" data-social-chat-form>
      ${socialChatPendingAttachmentsMarkup()}
      <textarea name="text" maxlength="2000" placeholder="Message ${escapeHtml(socialChatConversationTitle(conversation))}" aria-label="social chat message"></textarea>
      ${socialChatEmojiPickerMarkup()}
      <div class="social-chat-form-actions">
        <label class="mini-action">
          File
          <input data-social-image-input type="file" accept="image/png,image/jpeg,image/gif,image/webp,.apk,.zip,.iso,.pdf,.txt,.md,.json,.doc,.docx,.xls,.xlsx,.ppt,.pptx" multiple hidden />
        </label>
        <label class="mini-action social-camera-action" title="Camera" aria-label="Open camera and post photo">
          <span aria-hidden="true">&#128247;</span>
          <input data-social-camera-input type="file" accept="image/*" capture="environment" hidden />
        </label>
        <button data-social-emoji-toggle class="mini-action" type="button">Lab</button>
        <span>${socialChatUploading ? "Uploading file" : "Paste images or attach files"}</span>
        <button type="submit" ${socialChatUploading ? "disabled" : ""}>Send</button>
      </div>
    </form>
  `;
}

function socialChatMessageMarkup(message: SocialChatMessage): string {
  const mine = message.user === hostUsername;
  return `
    <div class="social-message ${mine ? "is-mine" : ""}">
      <strong>${escapeHtml(mine ? "You" : displayUserName(message.user))}</strong>
      ${message.text ? `<p>${escapeHtml(message.text)}</p>` : ""}
      ${socialChatAttachmentsMarkup(message.attachments ?? [])}
      ${socialChatReactionsMarkup(message)}
      <span>${escapeHtml(formatClockTime(message.createdUnixMs))}</span>
    </div>
  `;
}

function socialChatAttachmentsMarkup(attachments: SocialChatAttachment[]): string {
  if (attachments.length === 0) {
    return "";
  }
  return `
    <div class="social-attachment-grid">
      ${attachments
        .map(
          (attachment) =>
            isSocialChatImageAttachment(attachment)
              ? `
                <a href="${escapeHtml(bridgeUrl(attachment.url))}" target="_blank" rel="noreferrer">
                  <img src="${escapeHtml(bridgeUrl(attachment.url))}" alt="${escapeHtml(attachment.name)}" loading="lazy" />
                </a>
              `
              : `
                <a class="social-file-attachment" href="${escapeHtml(bridgeUrl(attachment.url))}" target="_blank" rel="noreferrer" download="${escapeHtml(attachment.name)}">
                  <strong>${escapeHtml(socialChatFileIcon(attachment))}</strong>
                  <span>${escapeHtml(attachment.name)}</span>
                  <small>${escapeHtml(formatBytes(attachment.sizeBytes))}</small>
                </a>
              `,
        )
        .join("")}
    </div>
  `;
}

function socialChatReactionsMarkup(message: SocialChatMessage): string {
  const reactions = message.reactions ?? [];
  return `
    <div class="social-reaction-row">
      ${reactions
        .map((reaction) => {
          const emoji = socialChatEmojiForKey(reaction.key);
          const mine = hostUsername ? reaction.users.includes(hostUsername) : false;
          return `
            <button
              class="social-reaction-chip ${mine ? "is-mine" : ""}"
              data-social-reaction-message="${message.id}"
              data-social-reaction-key="${escapeHtml(reaction.key)}"
              type="button"
            >${escapeHtml(emoji.symbol)} ${reaction.users.length}</button>
          `;
        })
        .join("")}
      <select data-social-reaction-select="${message.id}" aria-label="react to message">
        <option value="">React</option>
        ${socialChatEmojis.map((emoji) => `<option value="${escapeHtml(emoji.key)}">${escapeHtml(emoji.symbol)} ${escapeHtml(emoji.label)}</option>`).join("")}
      </select>
    </div>
  `;
}

function socialChatEmojiPickerMarkup(): string {
  if (!socialChatEmojiPickerOpen) {
    return "";
  }
  return `
    <div class="social-emoji-picker">
      ${socialChatEmojis
        .filter((emoji) => !emoji.key.startsWith("thumbs-"))
        .map(
          (emoji) => `
            <button data-social-emoji="${escapeHtml(emoji.key)}" type="button">
              <strong>${escapeHtml(emoji.symbol)}</strong>
              <span>${escapeHtml(emoji.label)}</span>
            </button>
          `,
        )
        .join("")}
    </div>
  `;
}

function socialChatPendingAttachmentsMarkup(): string {
  if (socialChatPendingAttachments.length === 0) {
    return "";
  }
  return `
    <div class="social-pending-attachments">
      ${socialChatPendingAttachments
        .map(
          (attachment) => `
            <div class="social-pending-attachment">
              <img src="${escapeHtml(bridgeUrl(attachment.url))}" alt="${escapeHtml(attachment.name)}" />
              <button data-social-remove-attachment="${escapeHtml(attachment.id)}" type="button" aria-label="remove image">Remove</button>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function friendsWindowMarkup(): string {
  const friends = visibleInteractionFriends();
  return `
    <div class="workspace-window-section">
      <div class="section-head">
        <p class="section-label">Friends</p>
        <span>${friends.filter((friend) => friend.status === "Online").length} online</span>
      </div>
      <div class="interaction-list-rows">
        ${friendRowsMarkup(friends)}
      </div>
    </div>
  `;
}

function sharedSpacesWindowMarkup(): string {
  return `
    <div class="workspace-window-section">
      <div class="section-head">
        <p class="section-label">Shared Spaces</p>
        <span>${interactionSpaces.length} spaces</span>
      </div>
      <div class="workspace-list">
        ${interactionSpaces
          .map(
            (space) => `
              <button class="interaction-space-row" type="button">
                <strong>${escapeHtml(space.name)}</strong>
                <span>${escapeHtml(space.detail)}</span>
              </button>
            `,
          )
          .join("")}
      </div>
    </div>
  `;
}

function profileWindowMarkup(): string {
  const currentName = displayUserName(hostUsername ?? "Nichlas");
  return `
    <div class="workspace-window-section">
      <div class="section-head">
        <p class="section-label">Current User</p>
        <span>${hostUsername ? "Online" : "Offline"}</span>
      </div>
      <div class="profile-window-card">
        <span class="user-presence-dot"></span>
        <strong>${escapeHtml(currentName)}</strong>
        <small>${hostUsername ? "Authenticated on this EutherHost" : "Login required for shared tools"}</small>
      </div>
    </div>
  `;
}

function settingsWindowMarkup(): string {
  return `
    <div class="workspace-window-section">
      <div class="section-head">
        <p class="section-label">Settings</p>
        <span>Always available</span>
      </div>
      <div class="settings-appearance-panel">
        <div class="settings-panel-head">
          <div>
            <p class="section-label">Appearance</p>
            <strong>User Theme</strong>
          </div>
          <span>${escapeHtml(userThemeLabel(userTheme))}</span>
        </div>
        <div class="settings-option-grid" role="group" aria-label="theme">
          ${userThemeButton("light", "Light", "Bright cockpit for travel and daylight.")}
          ${userThemeButton("dark", "Dark", "Low-glare default workspace.")}
          ${userThemeButton("royal-apothic", "Royal Apothic", "Gold, violet and apothecary glass.")}
        </div>
        <div class="settings-panel-head">
          <div>
            <p class="section-label">Skins</p>
            <strong>Surface Style</strong>
          </div>
          <span>${escapeHtml(userSkinLabel(userSkin))}</span>
        </div>
        <div class="settings-option-grid" role="group" aria-label="skin">
          ${userSkinButton("classic", "Classic", "Clean Euther panels.")}
          ${userSkinButton("glass", "Glass", "Sharper translucent surfaces.")}
          ${userSkinButton("arcade", "Arcade", "Chunkier cabinet controls.")}
        </div>
        <div class="settings-skin-loader">
          <label class="mini-action">
            Load Skin
            <input data-settings-custom-skin-input type="file" accept="text/css,.css" hidden />
          </label>
          <button data-settings-clear-custom-skin class="mini-action" type="button" ${userSkin !== "custom" ? "disabled" : ""}>Clear Skin</button>
        </div>
      </div>
      <div class="settings-audio-panel">
        <div class="volume-head">
          <p class="section-label">Sound</p>
          <strong id="settings-volume-value">${Math.round(audioVolume * 100)}%</strong>
        </div>
        <input id="settings-volume-slider" data-settings-audio-slider="volume" type="range" min="0" max="100" value="${Math.round(audioVolume * 100)}" aria-label="settings volume" />
        <div class="volume-head">
          <p class="section-label">Mic</p>
          <strong id="settings-mic-volume-value">${Math.round(micVolume * 100)}%</strong>
        </div>
        <input id="settings-mic-volume-slider" data-settings-audio-slider="mic" type="range" min="0" max="160" value="${Math.round(micVolume * 100)}" aria-label="settings mic volume" />
        <button class="primary-action" data-settings-audio-resume="true" type="button">Turn sound on</button>
      </div>
      <div class="workspace-window-grid">
        <button class="workspace-tool-card" type="button" disabled>
          <span>Controls</span>
          <strong>Input Matrix</strong>
          <small>Use the Controls button in the active play view.</small>
        </button>
      </div>
    </div>
  `;
}

function userThemeButton(theme: UserTheme, label: string, detail: string): string {
  return `
    <button class="settings-option-card ${userTheme === theme ? "is-selected" : ""}" data-settings-theme="${theme}" type="button">
      <span>${escapeHtml(label)}</span>
      <small>${escapeHtml(detail)}</small>
    </button>
  `;
}

function userSkinButton(skin: Exclude<UserSkin, "custom">, label: string, detail: string): string {
  return `
    <button class="settings-option-card ${userSkin === skin ? "is-selected" : ""}" data-settings-skin="${skin}" type="button">
      <span>${escapeHtml(label)}</span>
      <small>${escapeHtml(detail)}</small>
    </button>
  `;
}

function userThemeLabel(theme: UserTheme): string {
  switch (theme) {
    case "light":
      return "Light";
    case "royal-apothic":
      return "Royal Apothic";
    default:
      return "Dark";
  }
}

function userSkinLabel(skin: UserSkin): string {
  switch (skin) {
    case "glass":
      return "Glass";
    case "arcade":
      return "Arcade";
    case "custom":
      return "Custom";
    default:
      return "Classic";
  }
}

async function activatePlayMode(mode: PlayMode): Promise<void> {
  navigateApp(mode);
  if (mode === "euthercivet") {
    if (dogsMode) {
      leaveDogsMode();
    }
    if (!civetMode) {
      await enterCivetMode();
    }
    return;
  }
  if (civetMode) {
    leaveCivetMode();
  }
  if (mode === "eutherdogs") {
    if (!dogsMode) {
      await enterDogsMode();
    }
    return;
  }

  if (dogsMode) {
    leaveDogsMode();
  }

  if (mode === "megadrive") {
    megaDrivePanel.open = true;
    await selectFirstLobbyInstanceForKind("megadrive");
    return;
  }

  if (mode === "eutheralert") {
    await requestEutherAlertFullscreen(true);
    await ensureEutherAlertVesselForPlay();
    await startEutherAlertRenderer();
    return;
  }

  if (mode === "eutherduke") {
    return;
  }

  await selectFirstLobbyInstanceForKind("eutherdoom");
}

async function selectFirstLobbyInstanceForKind(kind: NonNullable<LobbyInstance["kind"]>): Promise<void> {
  const instance = lobbyStatus?.instances.find((candidate) => lobbyInstanceKind(candidate) === kind);
  if (!instance) {
    renderLobby();
    return;
  }
  await selectLobbyInstance(instance.id);
}

async function ensureEutherAlertVesselForPlay(): Promise<boolean> {
  if (!eutherAlertVesselEnsurePromise) {
    eutherAlertVesselEnsurePromise = ensureEutherAlertVesselForPlayInner().finally(() => {
      eutherAlertVesselEnsurePromise = null;
    });
  }
  return eutherAlertVesselEnsurePromise;
}

async function ensureEutherAlertVesselForPlayInner(): Promise<boolean> {
  if (!lobbyStatus) {
    await refreshLobby();
  }
  const active = activeLobbyInstance();
  if (active && lobbyInstanceKind(active) === "eutheralert") {
    if (lobbyRole === "spectator" || claimedLobbyPlayer === null) {
      await joinLobbyInstance("auto", { startRenderer: false });
    }
    return true;
  }
  const existing = lobbyStatus?.instances.find((candidate) => lobbyInstanceKind(candidate) === "eutheralert");
  if (existing) {
    await selectLobbyInstance(existing.id, { startRenderer: false });
    await joinLobbyInstance("auto", { startRenderer: false });
    return true;
  }
  await startLobbyInstance("eutheralert", { startRenderer: false });
  return activeLobbyInstance()?.kind === "eutheralert";
}

function lobbyInstanceKind(instance: LobbyInstance): NonNullable<LobbyInstance["kind"]> {
  return instance.kind ?? "megadrive";
}

function lobbyKindLabel(kind: NonNullable<LobbyInstance["kind"]> | null): string {
  switch (kind) {
    case "megadrive":
      return "MegaDrive";
    case "eutheralert":
      return "EutherAlert";
    case "eutherdoom":
      return "EutherDoom";
    default:
      return "Reaction";
  }
}

function setUserMenuOpen(open: boolean): void {
  userMenuOpen = open;
  userMenu.classList.toggle("is-open", open);
  userMenuToggle.setAttribute("aria-expanded", open ? "true" : "false");
}

function renderUserMenu(): void {
  userMenuName.textContent = displayUserName(hostUsername ?? "Nichlas");
  userMenuToggle.classList.toggle("is-selected", activeWorkspaceWindow !== null || appRoute === "interactionLobby");
  userSettingsToggle.classList.toggle("is-selected", activeWorkspaceWindow === "settings");
  userMenuAdmin.hidden = !hostIsAdmin;
}

async function loadInteractionUsers(): Promise<void> {
  if (interactionUsersLoaded) {
    return;
  }
  if (!hostUsername) {
    interactionUsersStatus = "Login to sync";
    renderInteractionUsers();
    return;
  }
  interactionUsersStatus = "Loading";
  renderInteractionUsers();
  try {
    const result = await bridgeJson<InteractionUsersResult>("/api/interaction/users", {}, 900);
    interactionUsers = result.users.map((user) => ({
      ...user,
      status: user.online ?? user.status === "Online" ? "Online" : "Offline",
    }));
    interactionUsersLoaded = true;
    interactionUsersStatus = "Host users";
  } catch {
    interactionUsersLoaded = false;
    interactionUsersStatus = "Mock users";
  }
  renderInteractionUsers();
}

function renderInteractionUsers(): void {
  const currentName = displayUserName(hostUsername ?? "Nichlas");
  interactionCurrentUserName.textContent = `Current user: ${currentName}`;
  interactionCurrentUserStatus.textContent = hostUsername ? "Online" : "Offline";
  const friends = visibleInteractionFriends();
  const onlineCount = friends.filter((friend) => friend.status === "Online").length;
  friendPreviewCount.textContent = `${onlineCount} online / ${interactionUsersStatus}`;
  friendPreviewRows.innerHTML = friendRowsMarkup(friends);
  renderShoppingShareControls();
  renderEutheriumLobby();
  if (activeWorkspaceWindow) {
    renderWorkspaceWindow();
  }
}

function displayUserName(username: string): string {
  if (!username) {
    return "Nichlas";
  }
  if (username === "codex") {
    return "Codex Developer";
  }
  return username.charAt(0).toUpperCase() + username.slice(1);
}

function socialChatSelectedConversation(): SocialChatConversation | null {
  return socialChatConversations.find((conversation) => conversation.id === socialChatSelectedConversationId) ?? null;
}

function socialChatConversationTitle(conversation: SocialChatConversation): string {
  if (conversation.title?.trim()) {
    return conversation.title.trim();
  }
  const others = conversation.participants.filter((participant) => participant !== hostUsername);
  if (conversation.kind === "direct") {
    return displayUserName(others[0] ?? conversation.participants[0] ?? "Chat");
  }
  return others.length > 0
    ? others.map(displayUserName).join(", ")
    : conversation.participants.map(displayUserName).join(", ");
}

function formatClockTime(unixMs: number): string {
  if (!Number.isFinite(unixMs) || unixMs <= 0) {
    return "";
  }
  return new Date(unixMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

async function loadSocialChatConversations(force = false): Promise<void> {
  if (!hostUsername) {
    socialChatStatus = "Login required";
    renderActiveSocialChatWindow();
    return;
  }
  if (socialChatLoading && !force) {
    return;
  }
  socialChatLoading = true;
  socialChatStatus = "Loading";
  renderActiveSocialChatWindow();
  try {
    const result = await bridgeJson<SocialChatConversationsResult>("/api/social/conversations", {}, 1200);
    socialChatConversations = result.conversations;
    if (
      socialChatSelectedConversationId &&
      !socialChatConversations.some((conversation) => conversation.id === socialChatSelectedConversationId)
    ) {
      socialChatSelectedConversationId = null;
      socialChatMessages = [];
    }
    socialChatStatus = "Synced";
  } catch (err) {
    socialChatStatus = err instanceof Error ? err.message : "Social chat offline";
  } finally {
    socialChatLoading = false;
  }
  renderActiveSocialChatWindow();
}

async function searchSocialChatUsers(): Promise<void> {
  if (!hostUsername) {
    socialChatUsers = [];
    renderActiveSocialChatWindow();
    return;
  }
  try {
    const query = encodeURIComponent(socialChatSearchQuery.trim());
    const result = await bridgeJson<SocialChatUsersResult>(`/api/social/users?query=${query}`, {}, 900);
    socialChatUsers = result.users;
  } catch {
    socialChatUsers = [];
  }
  renderActiveSocialChatWindow();
}

function toggleSocialChatUser(user: string): void {
  if (socialChatSelectedUsers.has(user)) {
    socialChatSelectedUsers.delete(user);
  } else {
    socialChatSelectedUsers.add(user);
  }
  renderActiveSocialChatWindow();
}

async function createSocialChatFromSelection(): Promise<void> {
  const participants = [...socialChatSelectedUsers];
  if (participants.length === 0) {
    return;
  }
  socialChatStatus = "Creating chat";
  renderActiveSocialChatWindow();
  try {
    const result = await bridgeJson<SocialChatConversationResult>(
      "/api/social/conversations",
      {
        method: "POST",
        body: JSON.stringify({ participants }),
      },
      1200,
    );
    upsertSocialChatConversation(result.conversation);
    socialChatSelectedUsers = new Set();
    socialChatSelectedConversationId = result.conversation.id;
    await loadSocialChatMessages(result.conversation.id);
  } catch (err) {
    socialChatStatus = err instanceof Error ? err.message : "Could not create chat";
    renderActiveSocialChatWindow();
  }
}

async function selectSocialChatConversation(conversationId: string): Promise<void> {
  socialChatSelectedConversationId = conversationId;
  socialChatMessages = [];
  socialChatHasOlder = false;
  socialChatThreadDetailsExpanded = false;
  await loadSocialChatMessages(conversationId);
}

async function loadSocialChatMessages(conversationId: string, beforeId?: number): Promise<void> {
  socialChatStatus = "Loading messages";
  renderActiveSocialChatWindow();
  try {
    const params = new URLSearchParams({ limit: "80" });
    if (beforeId !== undefined) {
      params.set("before", String(beforeId));
    }
    const result = await bridgeJson<SocialChatMessagesResult>(
      `/api/social/conversations/${encodeURIComponent(conversationId)}/messages?${params}`,
      {},
      1200,
    );
    upsertSocialChatConversation(result.conversation);
    socialChatMessages = beforeId === undefined ? result.messages : [...result.messages, ...socialChatMessages];
    socialChatHasOlder = result.hasOlder;
    socialChatStatus = "Synced";
  } catch (err) {
    socialChatStatus = err instanceof Error ? err.message : "Could not load messages";
  }
  renderActiveSocialChatWindow();
}

async function refreshActiveSocialChat(_reason: string, minIntervalMs = 1500): Promise<void> {
  if (activeWorkspaceWindow !== "interaction" || !hostUsername || socialChatRefreshInFlight) {
    return;
  }
  const now = Date.now();
  if (minIntervalMs > 0 && now - socialChatLastRefreshAt < minIntervalMs) {
    return;
  }
  socialChatLastRefreshAt = now;
  socialChatRefreshInFlight = true;
  const selectedBeforeRefresh = socialChatSelectedConversationId;
  const messageList = workspaceWindowDynamic.querySelector<HTMLDivElement>(".social-message-list");
  const previousScrollTop = messageList?.scrollTop ?? 0;
  const previousScrollHeight = messageList?.scrollHeight ?? 0;
  const draftTextarea = workspaceWindowDynamic.querySelector<HTMLTextAreaElement>('[data-social-chat-form] textarea[name="text"]');
  const draftText = draftTextarea?.value ?? "";
  const restoreTextareaFocus = draftTextarea !== null && document.activeElement === draftTextarea;
  const shouldStickToBottom = messageList
    ? messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight < 32
    : true;
  try {
    await loadSocialChatConversations(true);
    const selectedAfterRefresh = socialChatSelectedConversationId ?? selectedBeforeRefresh;
    if (selectedAfterRefresh) {
      await loadSocialChatMessages(selectedAfterRefresh);
    }
    if (shouldStickToBottom) {
      const refreshedList = workspaceWindowDynamic.querySelector<HTMLDivElement>(".social-message-list");
      if (refreshedList) {
        refreshedList.scrollTop = refreshedList.scrollHeight;
      }
    } else {
      const refreshedList = workspaceWindowDynamic.querySelector<HTMLDivElement>(".social-message-list");
      if (refreshedList) {
        refreshedList.scrollTop = previousScrollTop + Math.max(0, refreshedList.scrollHeight - previousScrollHeight);
      }
    }
    const refreshedTextarea = workspaceWindowDynamic.querySelector<HTMLTextAreaElement>('[data-social-chat-form] textarea[name="text"]');
    if (refreshedTextarea && draftText) {
      refreshedTextarea.value = draftText;
      if (restoreTextareaFocus) {
        refreshedTextarea.focus({ preventScroll: true });
        refreshedTextarea.setSelectionRange(draftText.length, draftText.length);
      }
    }
  } catch {
    // The underlying loaders set user-visible status.
  } finally {
    socialChatRefreshInFlight = false;
  }
}

async function loadOlderSocialChatMessages(): Promise<void> {
  const first = socialChatMessages[0];
  if (!socialChatSelectedConversationId || !first) {
    return;
  }
  await loadSocialChatMessages(socialChatSelectedConversationId, first.id);
}

async function sendSocialChatMessage(): Promise<void> {
  if (!socialChatSelectedConversationId) {
    return;
  }
  const textarea = workspaceWindowDynamic.querySelector<HTMLTextAreaElement>('[data-social-chat-form] textarea[name="text"]');
  const text = textarea?.value.trim() ?? "";
  if (!text && socialChatPendingAttachments.length === 0) {
    return;
  }
  try {
    const result = await bridgeJson<SocialChatPostResult>(
      `/api/social/conversations/${encodeURIComponent(socialChatSelectedConversationId)}/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          text,
          attachments: socialChatPendingAttachments.map((attachment) => attachment.id),
        }),
      },
      1200,
    );
    upsertSocialChatConversation(result.conversation);
    socialChatMessages = [...socialChatMessages, result.message];
    socialChatPendingAttachments = [];
    socialChatStatus = "Sent";
    if (textarea) {
      textarea.value = "";
    }
  } catch (err) {
    socialChatStatus = err instanceof Error ? err.message : "Could not send";
  }
  renderActiveSocialChatWindow();
}

async function toggleSocialMessageReaction(messageId: number, key: string): Promise<void> {
  if (!socialChatSelectedConversationId || !key) {
    return;
  }
  try {
    const result = await bridgeJson<SocialChatReactionResult>(
      `/api/social/conversations/${encodeURIComponent(socialChatSelectedConversationId)}/messages/${messageId}/reactions`,
      {
        method: "POST",
        body: JSON.stringify({ key }),
      },
      1200,
    );
    upsertSocialChatConversation(result.conversation);
    socialChatMessages = socialChatMessages.map((message) =>
      message.id === result.message.id ? result.message : message,
    );
    socialChatStatus = "Reacted";
  } catch (err) {
    socialChatStatus = err instanceof Error ? err.message : "Could not react";
  }
  renderActiveSocialChatWindow();
}

async function uploadSocialChatFiles(files: File[]): Promise<void> {
  const uploadFiles = files
    .slice(0, Math.max(0, 6 - socialChatPendingAttachments.length));
  if (uploadFiles.length === 0) {
    return;
  }
  socialChatUploading = true;
  socialChatStatus = "Uploading file";
  renderActiveSocialChatWindow();
  try {
    const attachments = await uploadSocialChatAttachments(uploadFiles);
    socialChatPendingAttachments = [...socialChatPendingAttachments, ...attachments];
    socialChatStatus = "File ready";
  } catch (err) {
    socialChatStatus = err instanceof Error ? err.message : "File upload failed";
  } finally {
    socialChatUploading = false;
  }
  renderActiveSocialChatWindow();
}

async function postSocialChatCameraFiles(files: File[]): Promise<void> {
  if (!socialChatSelectedConversationId || files.length === 0) {
    return;
  }
  const cameraFiles = files.filter((file) => file.type.startsWith("image/") || isImageFileName(file.name)).slice(0, 1);
  if (cameraFiles.length === 0) {
    socialChatStatus = "Camera needs an image";
    renderActiveSocialChatWindow();
    return;
  }
  const textarea = workspaceWindowDynamic.querySelector<HTMLTextAreaElement>('[data-social-chat-form] textarea[name="text"]');
  const text = textarea?.value.trim() ?? "";
  socialChatUploading = true;
  socialChatStatus = "Posting photo";
  renderActiveSocialChatWindow();
  let attachments: SocialChatAttachment[] = [];
  try {
    attachments = await uploadSocialChatAttachments(cameraFiles, "photo.jpg");
    const result = await bridgeJson<SocialChatPostResult>(
      `/api/social/conversations/${encodeURIComponent(socialChatSelectedConversationId)}/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          text,
          attachments: attachments.map((attachment) => attachment.id),
        }),
      },
      1200,
    );
    upsertSocialChatConversation(result.conversation);
    socialChatMessages = [...socialChatMessages, result.message];
    socialChatStatus = "Photo posted";
    if (textarea) {
      textarea.value = "";
    }
  } catch (err) {
    if (attachments.length > 0) {
      socialChatPendingAttachments = [...socialChatPendingAttachments, ...attachments];
      socialChatStatus = err instanceof Error ? `${err.message}; photo saved` : "Photo saved";
    } else {
      socialChatStatus = err instanceof Error ? err.message : "Photo post failed";
    }
  } finally {
    socialChatUploading = false;
  }
  renderActiveSocialChatWindow();
}

async function uploadSocialChatAttachments(files: File[], fallbackName = "file"): Promise<SocialChatAttachment[]> {
  const attachments: SocialChatAttachment[] = [];
  for (const file of files) {
    const contentType = file.type || contentTypeFromFileName(file.name || fallbackName);
    const params = new URLSearchParams({
      name: file.name || fallbackName,
      contentType,
    });
    const result = await bridgeJson<SocialChatAttachmentResult>(
      `/api/social/attachments/raw?${params}`,
      {
        method: "POST",
        headers: { "Content-Type": contentType },
        body: file,
      },
      0,
    );
    attachments.push(result.attachment);
  }
  return attachments;
}

function insertSocialChatEmoji(key: string): void {
  const emoji = socialChatEmojiForKey(key);
  const textarea = workspaceWindowDynamic.querySelector<HTMLTextAreaElement>('[data-social-chat-form] textarea[name="text"]');
  if (!textarea) {
    return;
  }
  const token = `${emoji.symbol} `;
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  textarea.value = `${textarea.value.slice(0, start)}${token}${textarea.value.slice(end)}`;
  textarea.focus({ preventScroll: true });
  textarea.setSelectionRange(start + token.length, start + token.length);
}

function removeSocialChatPendingAttachment(attachmentId: string): void {
  socialChatPendingAttachments = socialChatPendingAttachments.filter((attachment) => attachment.id !== attachmentId);
  renderActiveSocialChatWindow();
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const result = String(reader.result ?? "");
      resolve(result.includes(",") ? result.split(",", 2)[1] : result);
    });
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Could not read image")));
    reader.readAsDataURL(file);
  });
}

function socialChatEmojiForKey(key: string): { key: string; label: string; symbol: string } {
  return socialChatEmojis.find((emoji) => emoji.key === key) ?? { key, label: key, symbol: "?" };
}

function isSocialChatImageAttachment(attachment: SocialChatAttachment): boolean {
  return attachment.contentType.startsWith("image/");
}

function isImageFileName(name: string): boolean {
  return /\.(png|jpe?g|gif|webp|heic|heif)$/i.test(name);
}

function socialChatFileIcon(attachment: SocialChatAttachment): string {
  const name = attachment.name.toLowerCase();
  if (name.endsWith(".apk")) {
    return "APK";
  }
  if (name.endsWith(".iso")) {
    return "ISO";
  }
  if (name.endsWith(".zip")) {
    return "ZIP";
  }
  if (name.endsWith(".pdf")) {
    return "PDF";
  }
  return "FILE";
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function contentTypeFromFileName(name: string): string {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  switch (extension) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "apk":
      return "application/vnd.android.package-archive";
    case "zip":
      return "application/zip";
    case "iso":
      return "application/x-iso9660-image";
    case "pdf":
      return "application/pdf";
    case "md":
      return "text/markdown";
    case "json":
      return "application/json";
    case "txt":
      return "text/plain";
    default:
      return "application/octet-stream";
  }
}

function upsertSocialChatConversation(conversation: SocialChatConversation): void {
  socialChatConversations = [
    conversation,
    ...socialChatConversations.filter((entry) => entry.id !== conversation.id),
  ].sort((a, b) => b.updatedUnixMs - a.updatedUnixMs);
}

function renderActiveSocialChatWindow(): void {
  if (activeWorkspaceWindow === "interaction") {
    const restoreSearchFocus = document.activeElement instanceof HTMLElement
      && document.activeElement.matches("[data-social-user-search]");
    renderWorkspaceWindow();
    if (restoreSearchFocus) {
      const search = workspaceWindowDynamic.querySelector<HTMLInputElement>("[data-social-user-search]");
      if (search) {
        search.focus({ preventScroll: true });
        search.setSelectionRange(search.value.length, search.value.length);
      }
    }
  }
}

async function handleUserMenuAction(action: string): Promise<void> {
  setUserMenuOpen(false);
  switch (action) {
    case "admin":
      await openAdminModal();
      return;
    case "reaction-lobby":
      closeWorkspaceWindow();
      navigateApp("playHome");
      return;
    case "interaction-lobby":
      closeWorkspaceWindow();
      navigateApp("playHome");
      return;
    case "shopping-list":
      openWorkspaceWindow("shopping");
      return;
    case "eutherium":
      openWorkspaceWindow("eutherium");
      return;
    case "audiobooks":
      openWorkspaceWindow("books");
      return;
    case "get-list-app":
      window.location.href = "/downloads/EutherList-release-signed.apk";
      return;
    case "get-sync-app":
      window.location.href = "/downloads/EutherSync-release-signed.apk";
      return;
    case "friends":
      openWorkspaceWindow("friends");
      return;
    case "shared-spaces":
      openWorkspaceWindow("spaces");
      return;
    case "profile":
      openWorkspaceWindow("profile");
      return;
    case "settings":
      openWorkspaceWindow("settings");
      return;
    case "logout":
      await logoutHostUser();
      return;
    default:
      return;
  }
}

async function openAdminModal(): Promise<void> {
  if (!hostIsAdmin) {
    return;
  }
  closeWorkspaceWindow();
  adminModal.classList.add("is-open");
  adminModal.setAttribute("aria-hidden", "false");
  await refreshHostUsers();
}

async function logoutHostUser(): Promise<void> {
  try {
    await leaveVideoChat(false);
    await bridgeRequest("/api/logout", { method: "POST" }, 1200);
  } catch {
    // The server redirects to /login; a navigation below is enough if fetch hides it.
  }
  window.location.href = "/login";
}

function defaultShoppingListMarkdown(): string {
  return [
    "# Hemmet Shopping List",
    "",
    "## Kyl",
    "- [ ] Milk",
    "",
    "## Torrvaror",
    "- [ ] Coffee",
    "",
    "## Hem & städ",
    "- [ ] Batteries",
    "",
    "## Djur",
    "- [ ] Dog snacks",
    "",
  ].join("\n");
}

async function loadShoppingList(): Promise<void> {
  if (shoppingListLoaded || shoppingListSaving) {
    return;
  }
  if (!hostUsername) {
    shoppingListStatus = "Login to sync";
    renderShoppingListItems();
    return;
  }
  shoppingListStatus = "Loading";
  renderShoppingListItems();
  try {
    const result = await bridgeJson<ShoppingListResult>("/api/interaction/shopping-list", {}, 1000);
    applyShoppingListResult(result, "Synced");
  } catch (err) {
    shoppingListLoaded = false;
    shoppingListStatus = err instanceof Error ? "Sync failed" : "Offline";
    renderShoppingListItems();
  }
}

function applyShoppingListResult(result: ShoppingListResult, status: string): void {
  shoppingListName = result.name;
  shoppingListSharedId = result.sharedId;
  shoppingListMarkdown = result.markdown;
  shoppingListMembers = normalizeShoppingListMemberResults(result.members);
  shoppingListRole = normalizeShoppingListRole(result.role ?? currentShoppingListMember()?.role ?? "owner");
  shoppingListCanEdit = result.canEdit ?? (shoppingListRole === "owner" || shoppingListRole === "edit");
  shoppingListCanManage = result.canManage ?? shoppingListRole === "owner";
  shoppingListLoaded = true;
  shoppingListStatus = status;
  renderShoppingListItems();
}

function parseShoppingListCategories(markdown: string): ShoppingListCategoryGroup[] {
  const groups = new Map<string, ShoppingListItem[]>();
  let currentCategory: string | null = null;
  markdown.split("\n").forEach((line, lineIndex) => {
    const headingMatch = line.match(/^#{2,3}\s+(.+?)\s*$/);
    if (headingMatch) {
      currentCategory = normalizeShoppingCategoryName(headingMatch[1]);
      return;
    }
      const match = line.match(/^\s*-\s+\[( |x|X)\]\s+(.+?)\s*$/);
    if (!match) {
      return;
    }
    const text = match[2];
    const category = currentCategory ?? inferShoppingCategory(text);
    const items = groups.get(category) ?? [];
    items.push({
      lineIndex,
      checked: match[1].toLowerCase() === "x",
      text,
      category,
    });
    groups.set(category, items);
  });
  return sortShoppingCategoryGroups(
    Array.from(groups.entries()).map(([name, items]) => ({
      name,
      items,
    })),
  );
}

function renderShoppingListItems(): void {
  shoppingListTitle.textContent = shoppingListName;
  shoppingListStatusLabel.textContent = shoppingListSaving
    ? "Saving"
    : `${shoppingListStatus} / ${shoppingRoleLabel(shoppingListRole)}`;
  shoppingListSharedIdLabel.textContent = shoppingListSharedId;
  const editDisabled = shoppingListSaving || !hostUsername || !shoppingListCanEdit;
  shoppingListSort.disabled = editDisabled;
  shoppingListSave.disabled = editDisabled;
  shoppingListAddInput.disabled = editDisabled;
  shoppingListCategory.disabled = editDisabled;
  shoppingListMarkdownInput.disabled = editDisabled;
  renderShoppingShareControls();
  if (document.activeElement !== shoppingListMarkdownInput) {
    shoppingListMarkdownInput.value = shoppingListMarkdown;
  }
  const groups = parseShoppingListCategories(shoppingListMarkdown);
  shoppingListItems.innerHTML = groups.length
    ? groups
        .map((group) => {
          const openItems = group.items.filter((item) => !item.checked).length;
          return `
            <section class="shopping-list-category">
              <div class="shopping-list-category-head">
                <strong>${escapeHtml(group.name)}</strong>
                <span>${openItems}/${group.items.length}</span>
              </div>
              ${group.items
                .map(
                  (item) => `
                    <div class="shopping-list-item ${item.checked ? "is-checked" : ""}">
                      <label class="shopping-list-item-check">
                        <input data-shopping-line="${item.lineIndex}" type="checkbox" ${item.checked ? "checked" : ""} ${shoppingListCanEdit ? "" : "disabled"} />
                        <span>${escapeHtml(item.text)}</span>
                      </label>
                      <button data-shopping-remove="${item.lineIndex}" type="button" ${shoppingListCanEdit ? "" : "disabled"}>Remove</button>
                    </div>
                  `,
                )
                .join("")}
            </section>
          `;
        })
        .join("")
    : `<span>No checklist items yet</span>`;
}

function renderShoppingShareControls(): void {
  const members = normalizedShoppingListMembers();
  shoppingShareStatus.textContent = shoppingListSharing
    ? shoppingListShareStatus
    : `${members.length} ${members.length === 1 ? "member" : "members"} / ${shoppingRoleLabel(shoppingListRole)}`;
  shoppingShareCompact.innerHTML = shoppingShareCompactMarkup(members);
  shoppingListMembersEl.innerHTML = members.length
    ? members
        .map((member) => {
          const current = hostUsername && member.name === hostUsername;
          const roleControl = shoppingListCanManage && !current
            ? shoppingMemberRoleSelect(member)
            : `<em>${escapeHtml(current ? `You / ${shoppingRoleLabel(member.role)}` : shoppingRoleLabel(member.role))}</em>`;
          const removeControl = shoppingListCanManage && !current && member.role !== "owner"
            ? `<button data-shopping-unshare="${escapeHtml(member.name)}" type="button">Remove</button>`
            : "";
          return `
            <span class="shopping-member-chip ${current ? "is-current" : ""}">
              <strong>${escapeHtml(displayUserName(member.name))}</strong>
              ${roleControl}
              ${removeControl}
            </span>
          `;
        })
        .join("")
    : `<span class="interaction-empty">Only you</span>`;
  const memberNames = new Set(members.map((member) => member.name));
  const candidates = interactionUsers.filter((user) => user.name !== hostUsername && !memberNames.has(user.name));
  shoppingShareUser.innerHTML = candidates.length
    ? candidates.map((user) => `<option value="${escapeHtml(user.name)}">${escapeHtml(displayUserName(user.name))}</option>`).join("")
    : `<option value="">No users available</option>`;
  const disabled = shoppingListSharing || !hostUsername || !shoppingListCanManage || candidates.length === 0;
  shoppingShareUser.disabled = disabled;
  shoppingShareRole.disabled = disabled;
  shoppingShareForm.querySelector<HTMLButtonElement>("button")!.disabled = disabled;
}

function shoppingShareCompactMarkup(members: ShoppingListMember[]): string {
  if (members.length === 0) {
    return `<span>Only you</span>`;
  }
  const visible = members.slice(0, 3);
  const overflow = members.length - visible.length;
  const labels = visible
    .map((member) => {
      const current = member.name === hostUsername;
      return `<strong>${escapeHtml(current ? "You" : displayUserName(member.name))}</strong>`;
    })
    .join("");
  return `${labels}${overflow > 0 ? `<em>+${overflow}</em>` : ""}`;
}

function normalizedShoppingListMembers(): ShoppingListMember[] {
  const members = [...shoppingListMembers];
  if (hostUsername && !members.some((member) => member.name === hostUsername)) {
    members.unshift({
      name: hostUsername,
      role: shoppingListRole,
      isCurrentUser: true,
    });
  }
  const seen = new Set<string>();
  return members.filter((member) => {
    if (!member.name || seen.has(member.name)) {
      return false;
    }
    seen.add(member.name);
    return true;
  });
}

function shoppingMemberRoleSelect(member: ShoppingListMember): string {
  const options: ShoppingListRole[] = ["view", "edit", "owner"];
  return `
    <select data-shopping-role-user="${escapeHtml(member.name)}" aria-label="${escapeHtml(`role for ${member.name}`)}">
      ${options
        .map(
          (role) => `<option value="${role}" ${member.role === role ? "selected" : ""}>${escapeHtml(shoppingRoleLabel(role))}</option>`,
        )
        .join("")}
    </select>
  `;
}

function normalizeShoppingListMemberResults(members: Array<string | ShoppingListMember> | undefined): ShoppingListMember[] {
  const fallback = hostUsername
    ? [
        {
          name: hostUsername,
          role: shoppingListRole,
          isCurrentUser: true,
        },
      ]
    : [];
  return (members ?? fallback).map((member) =>
    typeof member === "string"
      ? {
          name: member,
          role: member === hostUsername ? "owner" : "edit",
          isCurrentUser: member === hostUsername,
        }
      : {
          ...member,
          role: normalizeShoppingListRole(member.role),
        },
  );
}

function currentShoppingListMember(): ShoppingListMember | null {
  return shoppingListMembers.find((member) => member.name === hostUsername) ?? null;
}

function normalizeShoppingListRole(role: string): ShoppingListRole {
  return role === "owner" || role === "edit" || role === "view" ? role : "view";
}

function shoppingRoleLabel(role: ShoppingListRole): string {
  switch (role) {
    case "owner":
      return "Owner";
    case "edit":
      return "Can edit";
    case "view":
      return "View only";
  }
}

async function shareShoppingList(): Promise<void> {
  const targetUser = shoppingShareUser.value;
  if (!targetUser || !hostUsername) {
    return;
  }
  shoppingListSharing = true;
  shoppingListShareStatus = `Sharing with ${displayUserName(targetUser)}`;
  renderShoppingShareControls();
  try {
    const result = await bridgeJson<ShoppingListResult>(
      "/api/interaction/shopping-list/share",
      {
        method: "POST",
        body: JSON.stringify({ user: targetUser, role: shoppingShareRole.value }),
      },
      1200,
    );
    applyShoppingListResult(result, `Shared with ${displayUserName(targetUser)}`);
  } catch (err) {
    shoppingListShareStatus = err instanceof Error ? "Share failed" : "Offline";
  } finally {
    shoppingListSharing = false;
    renderShoppingShareControls();
  }
}

async function unshareShoppingList(targetUser: string): Promise<void> {
  if (!targetUser || targetUser === hostUsername || !hostUsername) {
    return;
  }
  shoppingListSharing = true;
  shoppingListShareStatus = `Removing ${displayUserName(targetUser)}`;
  renderShoppingShareControls();
  try {
    const result = await bridgeJson<ShoppingListResult>(
      "/api/interaction/shopping-list/unshare",
      {
        method: "POST",
        body: JSON.stringify({ user: targetUser }),
      },
      1200,
    );
    applyShoppingListResult(result, `Removed ${displayUserName(targetUser)}`);
  } catch (err) {
    shoppingListShareStatus = err instanceof Error ? "Remove failed" : "Offline";
  } finally {
    shoppingListSharing = false;
    renderShoppingShareControls();
  }
}

async function updateShoppingListMemberRole(targetUser: string, role: string): Promise<void> {
  if (!targetUser || !hostUsername || !shoppingListCanManage) {
    return;
  }
  const normalizedRole = normalizeShoppingListRole(role);
  shoppingListSharing = true;
  shoppingListShareStatus = `Setting ${displayUserName(targetUser)} to ${shoppingRoleLabel(normalizedRole)}`;
  renderShoppingShareControls();
  try {
    const result = await bridgeJson<ShoppingListResult>(
      "/api/interaction/shopping-list/role",
      {
        method: "POST",
        body: JSON.stringify({ user: targetUser, role: normalizedRole }),
      },
      1200,
    );
    applyShoppingListResult(result, `${displayUserName(targetUser)}: ${shoppingRoleLabel(normalizedRole)}`);
  } catch (err) {
    shoppingListShareStatus = err instanceof Error ? "Role failed" : "Offline";
  } finally {
    shoppingListSharing = false;
    renderShoppingShareControls();
  }
}

function setShoppingListItemChecked(lineIndex: number, checked: boolean): void {
  if (!shoppingListCanEdit) {
    shoppingListStatus = "View only";
    renderShoppingListItems();
    return;
  }
  const lines = shoppingListMarkdown.split("\n");
  const line = lines[lineIndex];
  if (line === undefined) {
    return;
  }
  lines[lineIndex] = line.replace(/\[( |x|X)\]/, checked ? "[x]" : "[ ]");
  shoppingListMarkdown = lines.join("\n");
  shoppingListStatus = "Edited";
  renderShoppingListItems();
  scheduleShoppingListSave();
}

function removeShoppingListItem(lineIndex: number): void {
  if (!shoppingListCanEdit) {
    shoppingListStatus = "View only";
    renderShoppingListItems();
    return;
  }
  const lines = shoppingListMarkdown.split("\n");
  const line = lines[lineIndex];
  if (!line || !/^\s*-\s+\[( |x|X)\]\s+/.test(line)) {
    return;
  }
  const removedItem = line.replace(/^\s*-\s+\[( |x|X)\]\s+/, "").trim();
  lines.splice(lineIndex, 1);
  shoppingListMarkdown = smartSortShoppingMarkdown(lines.join("\n"));
  shoppingListStatus = removedItem ? `Removed ${removedItem}` : "Removed item";
  renderShoppingListItems();
  scheduleShoppingListSave();
}

function addShoppingListItem(value: string): void {
  if (!shoppingListCanEdit) {
    shoppingListStatus = "View only";
    renderShoppingListItems();
    return;
  }
  const item = value.trim();
  if (!item) {
    return;
  }
  const category =
    shoppingListCategory.value === "auto"
      ? inferShoppingCategory(item)
      : normalizeShoppingCategoryName(shoppingListCategory.value);
  shoppingListMarkdown = smartSortShoppingMarkdown(appendShoppingListItem(shoppingListMarkdown, item, category));
  shoppingListAddInput.value = "";
  shoppingListStatus = `Added to ${category}`;
  renderShoppingListItems();
  scheduleShoppingListSave();
}

function smartSortShoppingList(): void {
  if (!shoppingListCanEdit) {
    shoppingListStatus = "View only";
    renderShoppingListItems();
    return;
  }
  shoppingListMarkdown = smartSortShoppingMarkdown(shoppingListMarkdown);
  shoppingListStatus = "Smart sorted";
  renderShoppingListItems();
  scheduleShoppingListSave();
}

function appendShoppingListItem(markdown: string, item: string, category: string): string {
  const base = markdown.trimEnd();
  return `${base}${base ? "\n\n" : ""}## ${category}\n- [ ] ${item}\n`;
}

function smartSortShoppingMarkdown(markdown: string): string {
  const title = shoppingMarkdownTitle(markdown);
  const groups = parseShoppingListCategories(markdown);
  const lines = [title, ""];
  for (const group of groups) {
    lines.push(`## ${group.name}`);
    for (const item of group.items) {
      lines.push(`- [${item.checked ? "x" : " "}] ${item.text}`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function shoppingMarkdownTitle(markdown: string): string {
  const title = markdown
    .split("\n")
    .map((line) => line.trim())
    .find((line) => /^#\s+[^#]/.test(line));
  return title ?? "# Hemmet Shopping List";
}

function sortShoppingCategoryGroups(groups: ShoppingListCategoryGroup[]): ShoppingListCategoryGroup[] {
  return groups
    .filter((group) => group.items.length > 0)
    .map((group) => ({
      ...group,
      items: [...group.items].sort(compareShoppingItems),
    }))
    .sort(compareShoppingCategories);
}

function compareShoppingItems(left: ShoppingListItem, right: ShoppingListItem): number {
  if (left.checked !== right.checked) {
    return left.checked ? 1 : -1;
  }
  return left.text.localeCompare(right.text, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function compareShoppingCategories(left: ShoppingListCategoryGroup, right: ShoppingListCategoryGroup): number {
  const leftRank = shoppingCategoryRank(left.name);
  const rightRank = shoppingCategoryRank(right.name);
  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }
  return left.name.localeCompare(right.name, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function shoppingCategoryRank(category: string): number {
  const index = shoppingCategoryOrder.findIndex((known) => shoppingLookupKey(known) === shoppingLookupKey(category));
  return index >= 0 ? index : shoppingCategoryOrder.length;
}

function normalizeShoppingCategoryName(category: string): string {
  const cleaned = category.trim().replace(/\s+/g, " ");
  const key = shoppingLookupKey(cleaned);
  const alias = shoppingCategoryAliases.get(key);
  if (alias) {
    return alias;
  }
  const known = shoppingCategoryOrder.find((candidate) => shoppingLookupKey(candidate) === key);
  return known ?? titleCaseWords(cleaned || "Other");
}

function inferShoppingCategory(text: string): string {
  const lookup = shoppingLookupKey(text);
  const tokens = new Set(lookup.split(" ").filter(Boolean));
  for (const rule of shoppingCategoryKeywords) {
    if (
      rule.words.some((word) => {
        const normalizedWord = shoppingLookupKey(word);
        return normalizedWord.includes(" ") ? lookup.includes(normalizedWord) : tokens.has(normalizedWord);
      })
    ) {
      return rule.category;
    }
  }
  return "Övrigt";
}

function shoppingLookupKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function titleCaseWords(value: string): string {
  return value
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function scheduleShoppingListSave(): void {
  if (shoppingListSaveTimer !== null) {
    window.clearTimeout(shoppingListSaveTimer);
  }
  shoppingListSaveTimer = window.setTimeout(() => {
    shoppingListSaveTimer = null;
    void saveShoppingList();
  }, 650);
}

async function saveShoppingList(): Promise<void> {
  if (!shoppingListCanEdit) {
    shoppingListStatus = "View only";
    renderShoppingListItems();
    return;
  }
  if (!hostUsername) {
    shoppingListStatus = "Login to save";
    renderShoppingListItems();
    return;
  }
  shoppingListSaving = true;
  renderShoppingListItems();
  try {
    const result = await bridgeJson<ShoppingListResult>(
      "/api/interaction/shopping-list",
      {
        method: "POST",
        body: JSON.stringify({ markdown: shoppingListMarkdown }),
      },
      1400,
    );
    applyShoppingListResult(result, "Saved");
  } catch (err) {
    shoppingListStatus = err instanceof Error ? "Save failed" : "Offline";
    renderShoppingListItems();
  } finally {
    shoppingListSaving = false;
    renderShoppingListItems();
  }
}

function videoChatCanUseRtc(): boolean {
  return (
    Boolean(window.RTCPeerConnection) &&
    (window.isSecureContext || localWebHost || isPrivateLanHostname(currentHostname))
  );
}

function videoChatCanSendLocalMedia(): boolean {
  return Boolean(navigator.mediaDevices?.getUserMedia) && window.isSecureContext;
}

async function joinVideoChat(wantCamera: boolean): Promise<void> {
  if (isTauri) {
    videoChatStatusMessage = "web only";
    renderVideoChat();
    return;
  }
  if (!videoChatCanUseRtc()) {
    videoChatStatusMessage = "rtc blocked";
    renderVideoChat();
    return;
  }
  if (!hostUsername) {
    await refreshAuthStatus();
  }
  if (!hostUsername) {
    videoChatStatusMessage = "login required";
    renderVideoChat();
    return;
  }
  try {
    if (wantCamera) {
      if (!videoChatCanSendLocalMedia()) {
        videoChatStatusMessage = "camera needs HTTPS";
        renderVideoChat();
        return;
      }
      await startVideoChatLocalStream();
    } else {
      stopVideoChatLocalStream();
    }
    if (videoChatJoined) {
      await leaveVideoChat(true, activeLobbyInstanceId, false);
    }
    videoChatJoined = true;
    videoChatSending = Boolean(videoChatLocalStream);
    videoChatLastSignalId = 0;
    videoChatStatusMessage = videoChatSending ? "camera joining" : "watch joining";
    renderVideoChat();
    const result = await bridgeJson<VideoChatResult>(
      `/api/video-chat/join?canSend=${videoChatSending ? "1" : "0"}`,
      { method: "POST" },
      1500,
    );
    await applyVideoChatStatus(result);
    setVideoChatPolling(true);
  } catch (err) {
    videoChatStatusMessage = err instanceof Error ? err.message : "join failed";
    videoChatJoined = false;
    setVideoChatPolling(false);
    closeVideoChatPeers();
    renderVideoChat();
  }
}

async function startVideoChatLocalStream(): Promise<void> {
  if (videoChatLocalStream?.getTracks().some((track) => track.readyState === "live")) {
    return;
  }
  stopVideoChatLocalStream();
  videoChatRawLocalStream = await navigator.mediaDevices.getUserMedia({
    video: {
      width: { ideal: 640 },
      height: { ideal: 360 },
      frameRate: { ideal: 24, max: 30 },
    },
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  videoChatLocalStream = createVideoChatSendStream(videoChatRawLocalStream);
  videoChatMuted = false;
  applyVideoChatMute();
  videoChatStatusMessage = "camera ready";
  renderVideoChat();
}

function createVideoChatSendStream(rawStream: MediaStream): MediaStream {
  const sendStream = new MediaStream();
  for (const track of rawStream.getVideoTracks()) {
    sendStream.addTrack(track);
  }
  const audioTracks = rawStream.getAudioTracks();
  if (audioTracks.length === 0) {
    return sendStream;
  }
  const AudioCtor = window.AudioContext ?? window.webkitAudioContext;
  if (!AudioCtor) {
    for (const track of audioTracks) {
      sendStream.addTrack(track);
    }
    return sendStream;
  }
  videoChatMicContext = new AudioCtor();
  videoChatMicGain = videoChatMicContext.createGain();
  const source = videoChatMicContext.createMediaStreamSource(new MediaStream(audioTracks));
  const destination = videoChatMicContext.createMediaStreamDestination();
  source.connect(videoChatMicGain);
  videoChatMicGain.connect(destination);
  applyVideoChatMicVolume();
  if (videoChatMicContext.state === "suspended") {
    void videoChatMicContext.resume();
  }
  for (const track of destination.stream.getAudioTracks()) {
    sendStream.addTrack(track);
  }
  return sendStream;
}

function stopVideoChatLocalStream(): void {
  if (!videoChatLocalStream && !videoChatRawLocalStream) {
    videoChatSending = false;
    return;
  }
  for (const track of videoChatLocalStream?.getTracks() ?? []) {
    track.stop();
  }
  for (const track of videoChatRawLocalStream?.getTracks() ?? []) {
    track.stop();
  }
  if (videoChatMicContext) {
    void videoChatMicContext.close();
  }
  videoChatRawLocalStream = null;
  videoChatLocalStream = null;
  videoChatMicContext = null;
  videoChatMicGain = null;
  videoChatSending = false;
  videoChatMuted = false;
}

function setVideoChatPolling(active: boolean): void {
  if (!active || isTauri || !videoChatJoined) {
    if (videoChatPollTimer !== null) {
      window.clearInterval(videoChatPollTimer);
      videoChatPollTimer = null;
    }
    return;
  }
  if (videoChatPollTimer !== null) {
    return;
  }
  void pollVideoChat();
  videoChatPollTimer = window.setInterval(() => void pollVideoChat(), 1100);
}

async function pollVideoChat(): Promise<void> {
  if (!videoChatJoined) {
    setVideoChatPolling(false);
    return;
  }
  try {
    const result = await bridgeJson<VideoChatResult>(
      `/api/video-chat?after=${videoChatLastSignalId}`,
      {},
      1200,
    );
    await applyVideoChatStatus(result);
  } catch (err) {
    videoChatStatusMessage = err instanceof Error ? err.message : "video chat offline";
    renderVideoChat();
  }
}

async function applyVideoChatStatus(result: VideoChatResult): Promise<void> {
  const remoteParticipants = result.participants
    .filter((participant) => participant.clientId !== bridgeClientId)
    .sort((left, right) => left.clientId.localeCompare(right.clientId));
  videoChatParticipants = remoteParticipants;
  const remoteIds = new Set(remoteParticipants.map((participant) => participant.clientId));
  for (const peerId of Array.from(videoChatPeers.keys())) {
    if (!remoteIds.has(peerId)) {
      closeVideoChatPeer(peerId);
    }
  }
  for (const participant of remoteParticipants) {
    const mode = videoChatPeerMode(participant);
    if (videoChatPeerModes.get(participant.clientId) !== mode) {
      closeVideoChatPeer(participant.clientId);
    }
    ensureVideoChatPeer(participant);
  }
  for (const signal of [...result.signals].sort((left, right) => left.id - right.id)) {
    videoChatLastSignalId = Math.max(videoChatLastSignalId, signal.id);
    if (signal.to === bridgeClientId) {
      await handleVideoChatSignal(signal);
    }
  }
  const peerCount = remoteParticipants.length;
  videoChatStatusMessage = videoChatJoined
    ? peerCount === 0
      ? videoChatSending ? "camera live" : "watching"
      : `${peerCount} peer${peerCount === 1 ? "" : "s"}`
    : "idle";
  renderVideoChat();
}

function ensureVideoChatPeer(participant: VideoChatParticipant): RTCPeerConnection {
  const existing = videoChatPeers.get(participant.clientId);
  if (existing && existing.connectionState !== "closed") {
    return existing;
  }
  const peer = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });
  videoChatPeers.set(participant.clientId, peer);
  videoChatPeerModes.set(participant.clientId, videoChatPeerMode(participant));
  const localTracks =
    videoChatLocalStream
      ?.getTracks()
      .filter((track) => track.readyState === "live") ?? [];
  let hasVideo = false;
  let hasAudio = false;
  for (const track of localTracks) {
    if (!videoChatLocalStream) {
      continue;
    }
    hasVideo ||= track.kind === "video";
    hasAudio ||= track.kind === "audio";
    peer.addTrack(track, videoChatLocalStream);
  }
  if (!hasVideo) {
    peer.addTransceiver("video", { direction: "recvonly" });
  }
  if (!hasAudio) {
    peer.addTransceiver("audio", { direction: "recvonly" });
  }
  peer.ontrack = (event) => {
    const stream = videoChatRemoteStreams.get(participant.clientId) ?? new MediaStream();
    if (!stream.getTracks().some((track) => track.id === event.track.id)) {
      stream.addTrack(event.track);
    }
    videoChatRemoteStreams.set(participant.clientId, stream);
    event.track.onended = () => {
      stream.removeTrack(event.track);
      if (stream.getTracks().length === 0) {
        videoChatRemoteStreams.delete(participant.clientId);
      }
      renderVideoChat();
    };
    renderVideoChat();
  };
  peer.onconnectionstatechange = () => {
    if (peer.connectionState === "failed" || peer.connectionState === "disconnected") {
      videoChatStatusMessage = "peer reconnecting";
      closeVideoChatPeer(participant.clientId);
      renderVideoChat();
    }
  };
  if (bridgeClientId < participant.clientId) {
    void makeVideoChatOffer(participant.clientId, peer);
  }
  return peer;
}

async function makeVideoChatOffer(peerId: string, peer: RTCPeerConnection): Promise<void> {
  if (videoChatMakingOffer.has(peerId) || !videoChatJoined || peer.signalingState !== "stable") {
    return;
  }
  videoChatMakingOffer.add(peerId);
  try {
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    await waitForIceGathering(peer, 2200);
    if (peer.localDescription?.type === "offer") {
      await sendVideoChatSignal(peerId, "offer", peer.localDescription.sdp ?? "");
    }
  } catch (err) {
    videoChatStatusMessage = err instanceof Error ? err.message : "offer failed";
    closeVideoChatPeer(peerId);
    renderVideoChat();
  } finally {
    videoChatMakingOffer.delete(peerId);
  }
}

async function handleVideoChatSignal(signal: VideoChatSignal): Promise<void> {
  const participant =
    videoChatParticipants.find((entry) => entry.clientId === signal.from) ?? {
      clientId: signal.from,
      user: "Peer",
      canSend: true,
      updatedUnixMs: signal.createdUnixMs,
    };
  const peer = ensureVideoChatPeer(participant);
  try {
    if (signal.type === "offer") {
      if (peer.signalingState !== "stable") {
        await peer
          .setLocalDescription({ type: "rollback" } as RTCSessionDescriptionInit)
          .catch(() => undefined);
      }
      await peer.setRemoteDescription({ type: "offer", sdp: signal.sdp });
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      await waitForIceGathering(peer, 2200);
      if (peer.localDescription?.type === "answer") {
        await sendVideoChatSignal(signal.from, "answer", peer.localDescription.sdp ?? "");
      }
      return;
    }
    if (signal.type === "answer" && peer.signalingState === "have-local-offer") {
      await peer.setRemoteDescription({ type: "answer", sdp: signal.sdp });
    }
  } catch (err) {
    videoChatStatusMessage = err instanceof Error ? err.message : "signal failed";
    closeVideoChatPeer(signal.from);
    renderVideoChat();
  }
}

async function sendVideoChatSignal(
  peerId: string,
  type: VideoChatSignalType,
  sdp: string,
): Promise<void> {
  if (!videoChatJoined || !sdp) {
    return;
  }
  await bridgeJson(
    "/api/video-chat/signal",
    {
      method: "POST",
      body: JSON.stringify({ to: peerId, type, sdp }),
    },
    1500,
  );
}

function videoChatPeerMode(participant: VideoChatParticipant): string {
  const localTracks = videoChatLocalStream
    ?.getTracks()
    .filter((track) => track.readyState === "live")
    .map((track) => `${track.kind}:${track.id}`)
    .sort()
    .join(",") ?? "recvonly";
  return `${participant.canSend ? "peer-send" : "peer-watch"}|${localTracks}`;
}

function closeVideoChatPeer(peerId: string): void {
  const peer = videoChatPeers.get(peerId);
  if (peer) {
    peer.ontrack = null;
    peer.onconnectionstatechange = null;
    peer.close();
  }
  videoChatPeers.delete(peerId);
  videoChatRemoteStreams.delete(peerId);
  videoChatPeerModes.delete(peerId);
  videoChatMakingOffer.delete(peerId);
}

function closeVideoChatPeers(): void {
  for (const peerId of Array.from(videoChatPeers.keys())) {
    closeVideoChatPeer(peerId);
  }
}

function toggleVideoChatMute(): void {
  if (!videoChatLocalStream?.getAudioTracks().length) {
    return;
  }
  videoChatMuted = !videoChatMuted;
  applyVideoChatMute();
  renderVideoChat();
}

function applyVideoChatMute(): void {
  for (const track of videoChatLocalStream?.getAudioTracks() ?? []) {
    track.enabled = !videoChatMuted;
  }
}

async function leaveVideoChat(
  announce = true,
  instanceId = activeLobbyInstanceId,
  stopLocal = true,
): Promise<void> {
  const shouldAnnounce = announce && videoChatJoined && hostUsername && !isTauri;
  setVideoChatPolling(false);
  videoChatJoined = false;
  videoChatParticipants = [];
  videoChatLastSignalId = 0;
  videoChatStatusMessage = "idle";
  closeVideoChatPeers();
  if (stopLocal) {
    stopVideoChatLocalStream();
  }
  renderVideoChat();
  if (!shouldAnnounce) {
    return;
  }
  try {
    await bridgeJson(
      `/api/video-chat/leave?instance=${encodeURIComponent(instanceId)}`,
      { method: "POST" },
      900,
    );
  } catch {
    // Server-side participant leases expire quickly; unloads and network drops are harmless.
  }
}

function renderVideoChat(): void {
  const canRtc = videoChatCanUseRtc();
  const canSend = videoChatCanSendLocalMedia();
  videoChatStatus.textContent = videoChatStatusMessage;
  renderReactionLobbyToolStatus();
  videoChatWatch.disabled = isTauri || !hostUsername || !canRtc;
  videoChatCamera.disabled = isTauri || !hostUsername || !canRtc || !canSend;
  videoChatMute.disabled = !videoChatLocalStream?.getAudioTracks().length;
  videoChatLeave.disabled = !videoChatJoined && !videoChatLocalStream;
  videoChatWatch.textContent = videoChatJoined && !videoChatSending ? "Watching" : "Watch";
  videoChatCamera.textContent = videoChatSending ? "Camera On" : "Camera";
  videoChatMute.textContent = videoChatMuted ? "Unmute" : "Mute";
  videoChatCamera.title = canSend ? "" : "Camera and microphone need HTTPS or localhost";
  videoChatWatch.title = canRtc ? "" : "WebRTC is unavailable in this browser context";
  const key = [
    videoChatJoined ? "joined" : "idle",
    videoChatSending ? "sending" : "watching",
    videoChatMuted ? "muted" : "open",
    videoChatLocalStream?.id ?? "no-local",
    ...videoChatParticipants.map((participant) => {
      const stream = videoChatRemoteStreams.get(participant.clientId);
      return [
        participant.clientId,
        participant.user,
        participant.canSend,
        stream?.id ?? "no-stream",
        stream?.getTracks().length ?? 0,
      ].join(":");
    }),
  ].join("|");
  if (key !== videoChatRenderKey) {
    videoChatRenderKey = key;
    videoChatStage.innerHTML = videoChatStageMarkup();
  }
  syncVideoChatMediaElements();
}

function videoChatStageMarkup(): string {
  const tiles: string[] = [];
  if (videoChatLocalStream) {
    tiles.push(`
      <div class="video-chat-tile">
        <video data-video-chat-local autoplay playsinline muted></video>
        <span class="video-chat-badge">${videoChatMuted ? "You muted" : "You"}</span>
      </div>
    `);
  }
  for (const participant of videoChatParticipants) {
    const hasStream = videoChatRemoteStreams.has(participant.clientId);
    tiles.push(`
      <div class="video-chat-tile ${hasStream ? "" : "is-waiting"}">
        ${
          hasStream
            ? `<video data-video-chat-peer="${escapeHtml(participant.clientId)}" autoplay playsinline></video>`
            : `<strong>${participant.canSend ? "Waiting for media" : "Watch mode"}</strong>`
        }
        <span class="video-chat-badge">${escapeHtml(participant.user)}${participant.canSend ? "" : " watching"}</span>
      </div>
    `);
  }
  if (!tiles.length) {
    return `<span>${videoChatJoined ? "Waiting for peer" : "Video chat idle"}</span>`;
  }
  return tiles.join("");
}

function syncVideoChatMediaElements(): void {
  const localVideo = videoChatStage.querySelector<HTMLVideoElement>("[data-video-chat-local]");
  if (localVideo && videoChatLocalStream && localVideo.srcObject !== videoChatLocalStream) {
    localVideo.srcObject = videoChatLocalStream;
    localVideo.play().catch(() => undefined);
  }
  for (const video of videoChatStage.querySelectorAll<HTMLVideoElement>("[data-video-chat-peer]")) {
    const peerId = video.dataset.videoChatPeer ?? "";
    const stream = videoChatRemoteStreams.get(peerId);
    video.volume = audioVolume;
    if (stream && video.srcObject !== stream) {
      video.srcObject = stream;
      video.play().catch(() => undefined);
    }
  }
}

function renderLobby(): void {
  const routeKind = currentLobbyRouteKind();
  const activeInstance = activeLobbyInstance();
  const instance =
    routeKind && activeInstance && lobbyInstanceKind(activeInstance) !== routeKind ? undefined : activeInstance;
  if (!instance) {
    const modeLabel = lobbyKindLabel(routeKind);
    lobbyTitle.textContent = `No ${modeLabel} vessel`;
    lobbyMeta.textContent =
      routeKind === "eutherdoom"
        ? "Start EutherDoom to create a lockstep relay"
        : routeKind === "eutheralert"
          ? "Start EutherAlert to create a Red Alert vessel"
          : "Start MegaDrive to create a host room";
    lobbyHost.textContent = "Host: open";
    renderLobbyInstances();
    instanceJoin.disabled = true;
    releaseSlot.disabled = true;
    claimP1.disabled = true;
    claimP2.disabled = true;
    kickP1.disabled = true;
    kickP2.disabled = true;
    closeInstance.disabled = true;
    spectateInstance.classList.remove("is-selected");
    alertInstanceStart.disabled = false;
    renderDoomPanel();
    renderReactionLobbyHome();
    return;
  }
  renderLobbyInstances();
  const occupied = instance.players
    .map((player) => `P${player.player}:${player.occupied ? player.user ?? "busy" : "open"}`)
    .join(" ");
  lobbyTitle.textContent = instance.name;
  lobbyMeta.textContent =
    `${instance.modeLabel ?? lobbyKindLabel(lobbyInstanceKind(instance))} | ${instance.loaded ? instance.title : "No ROM"} | ${occupied} | ${instance.spectators} spec`;
  lobbyHost.textContent = `Host: ${instance.host ?? "open"}`;
  instanceJoin.textContent =
    lobbyRole === "spectator" || claimedLobbyPlayer === null ? "Join Auto" : `Joined P${claimedLobbyPlayer}`;
  instanceStart.disabled = false;
  alertInstanceStart.disabled = false;
  doomInstanceStart.disabled = false;
  releaseSlot.disabled = claimedLobbyPlayer === null && !ownsCurrentSlot();
  claimP1.disabled = claimedLobbyPlayer !== null || Boolean(instance.players.find((player) => player.player === 1)?.occupied);
  claimP2.disabled = claimedLobbyPlayer !== null || Boolean(instance.players.find((player) => player.player === 2)?.occupied);
  claimP1.classList.toggle("is-selected", claimedLobbyPlayer === 1);
  claimP2.classList.toggle("is-selected", claimedLobbyPlayer === 2);
  kickP1.disabled =
    !canHostMutate() || !Boolean(instance.players.find((player) => player.player === 1)?.occupied);
  kickP2.disabled =
    !canHostMutate() || !Boolean(instance.players.find((player) => player.player === 2)?.occupied);
  closeInstance.disabled = instance.id === "main" || !canHostMutate();
  spectateInstance.classList.toggle("is-selected", lobbyRole === "spectator");
  renderPlayerPort();
  if (dogsMenuMode === "staff") {
    renderDogsMenu();
  }
  renderDoomPanel();
  renderReactionLobbyHome();
}

function renderReactionLobbyHome(): void {
  const instances = lobbyStatus?.instances ?? [];
  const activeCount = instances.length;
  const playerCount = instances.reduce(
    (total, instance) => total + instance.players.filter((player) => player.occupied).length,
    0,
  );
  const spectatorCount = instances.reduce((total, instance) => total + instance.spectators, 0);
  reactionLobbySummary.textContent =
    activeCount === 0
      ? "No vessels"
      : `${activeCount} vessel${activeCount === 1 ? "" : "s"} | ${playerCount} players | ${spectatorCount} spectators`;
  reactionLobbyVessels.innerHTML = instances.length
    ? instances.map((instance) => reactionLobbyVesselCard(instance)).join("")
    : `
      <div class="reaction-lobby-empty">
        <strong>No active vessels</strong>
        <span>Start a MegaDrive chamber, EutherAlert, EutherDoom, or open EutherDogs/EutherCivet.</span>
      </div>
    `;
  renderEutheriumLobby();
  renderReactionLobbyToolStatus();
}

function renderReactionLobbyToolStatus(): void {
  const videoStatus = reactionLobbyHome.querySelector<HTMLElement>('[data-reaction-tool-status="video-chat"]');
  if (videoStatus) {
    videoStatus.textContent = videoChatStatusMessage;
  }
  const socialDeskStatus = reactionLobbyHome.querySelector<HTMLElement>('[data-reaction-tool-status="interaction"]');
  if (socialDeskStatus) {
    socialDeskStatus.textContent = `${visibleInteractionFriends().filter((friend) => friend.status === "Online").length} online`;
  }
}

function reactionLobbyVesselCard(instance: LobbyInstance): string {
  const kind = lobbyInstanceKind(instance);
  const modeLabel = instance.modeLabel ?? lobbyKindLabel(kind);
  const playerCount = instance.players.filter((player) => player.occupied).length;
  const title =
    instance.loaded
      ? instance.title
      : kind === "eutherdoom"
        ? "Lockstep relay ready"
        : kind === "eutheralert"
          ? "Red Alert vessel ready"
        : "No ROM loaded";
  const p1 = instance.players.find((player) => player.player === 1);
  const p2 = instance.players.find((player) => player.player === 2);
  return `
    <article class="reaction-vessel-card ${instance.id === activeLobbyInstanceId ? "is-selected" : ""}">
      <div class="reaction-vessel-main">
        <span>${escapeHtml(modeLabel)}</span>
        <strong>${escapeHtml(instance.name)}</strong>
        <small>${escapeHtml(title)}</small>
      </div>
      <div class="reaction-vessel-meta">
        <span>${playerCount}P</span>
        <span>${instance.spectators}S</span>
        <span>${escapeHtml(instance.host ? `Host ${instance.host}` : "Open host")}</span>
      </div>
      <div class="reaction-vessel-players">
        ${reactionLobbyPlayerPill(p1, 1)}
        ${reactionLobbyPlayerPill(p2, 2)}
      </div>
      <div class="reaction-vessel-actions">
        <button data-reaction-home-action="open" data-reaction-home-instance="${escapeHtml(instance.id)}" type="button">Open</button>
        <button data-reaction-home-action="join" data-reaction-home-instance="${escapeHtml(instance.id)}" type="button">Join</button>
        <button data-reaction-home-action="spectate" data-reaction-home-instance="${escapeHtml(instance.id)}" type="button">Spectate</button>
        <button data-reaction-home-action="claim-p1" data-reaction-home-instance="${escapeHtml(instance.id)}" type="button" ${p1?.occupied ? "disabled" : ""}>P1</button>
        <button data-reaction-home-action="claim-p2" data-reaction-home-instance="${escapeHtml(instance.id)}" type="button" ${p2?.occupied ? "disabled" : ""}>P2</button>
      </div>
    </article>
  `;
}

function reactionLobbyPlayerPill(player: LobbyPlayer | undefined, port: PlayerPort): string {
  const occupied = Boolean(player?.occupied);
  const label = occupied ? player?.user ?? "busy" : "open";
  return `
    <span class="${occupied ? "is-occupied" : ""}">
      <strong>P${port}</strong>
      <em>${escapeHtml(label)}</em>
    </span>
  `;
}

function activeLobbyInstance(): LobbyInstance | undefined {
  return (
    lobbyStatus?.instances.find((instance) => instance.id === activeLobbyInstanceId) ??
    lobbyStatus?.instances[0]
  );
}

function currentLobbyRouteKind(): NonNullable<LobbyInstance["kind"]> | null {
  if (appRoute === "megadrive") {
    return "megadrive";
  }
  if (appRoute === "eutheralert") {
    return "eutheralert";
  }
  if (appRoute === "eutherdoom") {
    return "eutherdoom";
  }
  return null;
}

function renderLobbyInstances(): void {
  const routeKind = currentLobbyRouteKind();
  const instances = (lobbyStatus?.instances ?? []).filter(
    (instance) => !routeKind || lobbyInstanceKind(instance) === routeKind,
  );
  lobbyInstances.innerHTML = instances.length
    ? instances
    .map(
      (instance) => `
        <button class="${instance.id === activeLobbyInstanceId ? "is-selected" : ""}" data-instance-id="${escapeHtml(instance.id)}" type="button">
          <strong>${escapeHtml(instance.name)}</strong>
          <span>${escapeHtml(instance.modeLabel ?? "MegaDrive")} | ${escapeHtml(instance.loaded ? instance.title : "No ROM")} | ${instance.players.filter((player) => player.occupied).length}P ${instance.spectators}S</span>
        </button>
      `,
    )
    .join("")
    : `<div class="lobby-empty"><strong>No ${lobbyKindLabel(routeKind)} rooms</strong><span>Start one from this mode.</span></div>`;
}

function renderDoomPanel(): void {
  const instance = activeLobbyInstance();
  const isDoom = appRoute === "eutherdoom" && instance?.kind === "eutherdoom";
  doomDebugPanel.hidden = !isDoom;
  if (!isDoom) {
    setDoomEventPolling(false);
    return;
  }
  if (doomStatus) {
    startDoomEventStream();
  }

  const players = doomStatus?.players ?? [];
  const readyCount = players.filter((player) => player.ready).length;
  const streamMode = doomEventStream ? "stream" : doomEventPollTimer !== null ? "poll" : "idle";
  const currentTic = doomStatus?.currentTic ?? instance?.frame ?? 0;
  const driveLead = doomDriveTimer === null ? "" : ` | drive ${Math.max(0, doomDriveSubmitted - currentTic)}`;

  doomTitle.textContent = instance?.name ?? "EutherDoom Server";
  doomMeta.textContent = `tic ${currentTic} | ${readyCount}/2 ready | ${streamMode}${driveLead} | replay ${doomStatus?.replayEvents ?? 0}`;
  doomVesselStatus.innerHTML = [1, 2]
    .map((player) => {
      const slot = players.find((entry) => entry.player === player);
      const mine = claimedLobbyPlayer === player;
      return `
        <div class="doom-player-slot ${slot?.ready ? "is-ready" : ""} ${mine ? "is-mine" : ""}">
          <span>P${player}</span>
          <strong>${escapeHtml(slot?.user ?? "Open")}</strong>
          <em>${slot ? slot.ready ? "Ready" : "Wait" : "Join"}</em>
        </div>
      `;
    })
    .join("");
  doomReady.disabled = claimedLobbyPlayer === null;
  doomUnready.disabled = claimedLobbyPlayer === null;
  doomSend.disabled = claimedLobbyPlayer === null;
  doomDrive.disabled = claimedLobbyPlayer === null;
  doomDrive.classList.toggle("is-selected", doomDriveTimer !== null);
  doomDrive.textContent = doomDriveTimer === null ? "Drive" : "Live";
  doomReplay.disabled = !doomStatus || doomStatus.replayEvents === 0;
  doomReset.disabled = !canHostMutate();

  if (doomStatus && doomTic.value === "") {
    doomTic.value = doomStatus.currentTic.toString();
  }

  const frames = doomStatus?.frames ?? [];
  doomFrameLog.innerHTML = frames.length
    ? frames
        .map((frame) => {
          const p1 = formatDoomCommand(frame.commands[0]);
          const p2 = formatDoomCommand(frame.commands[1]);
          return `<div><strong>TIC ${frame.tic}</strong><span>P1 ${escapeHtml(p1)}</span><span>P2 ${escapeHtml(p2)}</span></div>`;
        })
        .join("")
    : `<div><strong>No tic frames</strong><span>Ready both players and send matching tics.</span></div>`;
}

function formatDoomCommand(command: DoomCommand | undefined): string {
  if (!command) {
    return "0 0 0 0 0";
  }
  return `${command.forward} ${command.strafe} ${command.turn} ${command.buttons} ${command.weapon}`;
}

function ownsCurrentSlot(): boolean {
  if (!lobbyStatus) {
    return true;
  }
  if (!hostUsername) {
    return false;
  }
  const instance = activeLobbyInstance();
  const slot = instance?.players.find((player) => player.player === playerPort);
  return Boolean(slot?.occupied && hostUsername && slot.user === hostUsername);
}

function canHostMutate(): boolean {
  const host = activeLobbyInstance()?.host;
  return Boolean(hostPermissions.canLaunchRoms && (!host || host === hostUsername));
}

function canHostUploadRoms(): boolean {
  const host = activeLobbyInstance()?.host;
  return Boolean(hostPermissions.canUploadRoms && (!host || host === hostUsername));
}

function canHostManageLibrary(): boolean {
  return Boolean(hostPermissions.canManageLibrary);
}

function renderAdminAccess(): void {
  adminOpen.hidden = !hostIsAdmin;
  if (!hostIsAdmin) {
    adminModal.classList.remove("is-open");
    adminModal.setAttribute("aria-hidden", "true");
  }
}

function renderHostUsers(): void {
  const awardUsers = hostUsers.filter((user) => !user.banned);
  adminAwardUser.innerHTML = awardUsers.length
    ? awardUsers
        .map((user) => `<option value="${escapeHtml(user.name)}">${escapeHtml(displayUserName(user.name))}</option>`)
        .join("")
    : `<option value="">No active users</option>`;
  adminAwardUser.disabled = awardUsers.length === 0;
  adminAwardSend.disabled = awardUsers.length === 0;
  if (selectedAdminUser && awardUsers.some((user) => user.name === selectedAdminUser)) {
    adminAwardUser.value = selectedAdminUser;
  }
  adminUsers.innerHTML = hostUsers.length
    ? hostUsers
        .map(
          (user) => `
            <div class="admin-user ${user.name === selectedAdminUser ? "is-selected" : ""}">
              <button data-admin-select="${escapeHtml(user.name)}" type="button">
                <strong>${escapeHtml(user.name)}</strong>
                <span>${user.admin ? "Admin" : "User"} | ${user.banned ? "Banned" : "Active"} | ${hostPermissionSummary(user.permissions)}</span>
              </button>
              <button data-admin-admin="${escapeHtml(user.name)}" data-admin="${user.admin ? "0" : "1"}" type="button">
                ${user.admin ? "User" : "Admin"}
              </button>
              <button data-admin-ban="${escapeHtml(user.name)}" data-banned="${user.banned ? "0" : "1"}" type="button">
                ${user.banned ? "Unban" : "Ban"}
              </button>
              <div class="admin-permissions">
                ${hostPermissionButton(user, "canPlay", "Play")}
                ${hostPermissionButton(user, "canLaunchRoms", "Launch")}
                ${hostPermissionButton(user, "canUploadRoms", "Upload")}
                ${hostPermissionButton(user, "canManageLibrary", "Library")}
                ${hostPermissionButton(user, "canAwardEutherium", "Eutherium")}
              </div>
            </div>
          `,
        )
        .join("")
    : `<span>No users loaded</span>`;
}

function hostPermissionSummary(permissions: HostPermissions): string {
  const labels = [
    permissions.canPlay ? "Play" : "",
    permissions.canLaunchRoms ? "Launch" : "",
    permissions.canUploadRoms ? "Upload" : "",
    permissions.canManageLibrary ? "Library" : "",
    permissions.canAwardEutherium ? "Eutherium" : "",
  ].filter(Boolean);
  return labels.length ? labels.join(", ") : "Read-only";
}

function hostPermissionButton(user: HostUserSummary, key: keyof HostPermissions, label: string): string {
  const active = user.permissions[key];
  return `
    <button
      class="${active ? "is-active" : ""}"
      data-admin-permission-user="${escapeHtml(user.name)}"
      data-admin-permission="${key}"
      type="button"
      ${user.admin ? "disabled" : ""}
    >${label}</button>
  `;
}

function renderChat(): void {
  const shouldStickToBottom =
    chatList.scrollHeight - chatList.scrollTop - chatList.clientHeight < 24;
  chatList.innerHTML = chatMessages.length
    ? chatMessages
        .map(
          (entry) => `
            <div class="chat-message">
              <strong>${escapeHtml(entry.user)}</strong>
              <p>${escapeHtml(entry.message)}</p>
            </div>
          `,
        )
        .join("")
    : `<span>No messages</span>`;
  if (shouldStickToBottom) {
    chatList.scrollTop = chatList.scrollHeight;
  }
}

async function bridgeFrame(timeoutMs = 0): Promise<FrameResult> {
  const response = await bridgeRequest("/frame.bin", { method: "POST" }, timeoutMs);
  const buffer = await response.arrayBuffer();
  return decodeBridgeFrame(buffer);
}

async function bridgeAudio(timeoutMs = 0): Promise<AudioResult> {
  const response = await bridgeRequest("/audio.bin", { method: "POST" }, timeoutMs);
  const buffer = await response.arrayBuffer();
  return decodeBridgeAudio(buffer);
}

async function bridgeFrameAudio(timeoutMs = 0): Promise<FrameAudioResult> {
  const response = await bridgeRequest("/frame-audio.bin", { method: "POST" }, timeoutMs);
  const buffer = await response.arrayBuffer();
  return decodeBridgeFrameAudio(buffer);
}

function readBridgeClientId(): string {
  const stored = localStorage.getItem(bridgeClientStorageKey);
  if (stored) {
    return stored;
  }
  const generated =
    globalThis.crypto?.randomUUID?.() ??
    `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  localStorage.setItem(bridgeClientStorageKey, generated);
  return generated;
}

function bridgeUrl(path: string): string {
  const url = new URL(path, bridgeBase);
  if (!url.searchParams.has("instance")) {
    url.searchParams.set("instance", activeLobbyInstanceId);
  }
  url.searchParams.set("client", bridgeClientId);
  if (!url.searchParams.has("player")) {
    url.searchParams.set("player", String(playerPort));
  }
  if (lobbyRole === "spectator" && (path.includes("stream-frame-audio") || path.includes("/webrtc/offer"))) {
    url.searchParams.set("role", "spectator");
  }
  if (bridgeWebRtcVideoActive && path.includes("stream-frame-audio")) {
    url.searchParams.set("video", "0");
  }
  return url.toString();
}

async function bridgeStreamRequest(signal: AbortSignal): Promise<Response> {
  const response = await fetch(bridgeUrl("/stream-frame-audio.bin"), {
    method: "GET",
    credentials: "include",
    signal,
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response;
}

async function nativeBridgeRequest(
  path: string,
  init: RequestInit = {},
  timeoutMs = 0,
): Promise<Response> {
  if (!nativeBridgeBase) {
    nativeBridgeBase = await invoke<string>("native_bridge_url");
    if (!nativeBridgeBase) {
      throw new Error("Tauri native bridge is not armed");
    }
    pushTrace("Tauri localhost transport armed");
  }
  const controller = timeoutMs > 0 ? new AbortController() : null;
  const timeout =
    controller && window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${nativeBridgeBase}${path}`, {
      ...init,
      signal: controller?.signal,
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    return response;
  } finally {
    if (timeout) {
      window.clearTimeout(timeout);
    }
  }
}

async function tauriLocalFrameAudio(): Promise<FrameAudioResult> {
  const response = await nativeBridgeRequest("/frame-audio.bin");
  const buffer = await response.arrayBuffer();
  return { ...decodeBridgeFrameAudio(buffer), transport: "TAURI LOCALHOST AUDIO" };
}

async function tauriNativeFrame(): Promise<NativeFrameResult> {
  return await invoke<NativeFrameResult>("run_native_frame");
}

async function tauriNativeStatus(): Promise<NativeFrameResult | null> {
  return await invoke<NativeFrameResult | null>("native_frame_status");
}

async function tauriFrameAudio(): Promise<FrameAudioResult> {
  try {
    const packet = await invoke<ArrayBuffer | Uint8Array<ArrayBuffer> | number[]>(
      "run_frame_audio_packet",
    );
    const transport =
      packet instanceof ArrayBuffer
        ? "TAURI RAW BUFFER"
        : packet instanceof Uint8Array
          ? "TAURI RAW UINT8"
          : "TAURI RAW ARRAY";
    const buffer =
      packet instanceof ArrayBuffer
        ? packet
        : packet instanceof Uint8Array
          ? packet.buffer.slice(packet.byteOffset, packet.byteOffset + packet.byteLength)
          : new Uint8Array(packet).buffer;
    return { ...decodeBridgeFrameAudio(buffer), transport };
  } catch (error) {
    pushTrace(`Tauri IPC missed: ${String(error)}`);
  }

  try {
    return await tauriLocalFrameAudio();
  } catch (error) {
    nativeBridgeBase = null;
    pushTrace(`Tauri localhost missed: ${String(error)}`);
    throw error;
  }
}

function decodeBridgeFrameAudio(
  buffer: ArrayBuffer,
  deferVideo = false,
): DecodedFrameAudioPacket {
  const bytes = new Uint8Array(buffer);
  const magic = String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0);
  const headerLength = magic === "EOX2" || magic === "EOX3" || magic === "EOX4" ? 52 : 48;
  if (
    bytes.length < headerLength ||
    (magic !== "EOXB" && magic !== "EOX2" && magic !== "EOX3" && magic !== "EOX4")
  ) {
    throw new Error("Bad EutherOxide frame/audio packet");
  }
  const view = new DataView(buffer);
  const hasChannels = magic === "EOX2" || magic === "EOX3" || magic === "EOX4";
  const isRgb565 = magic === "EOX3" || magic === "EOX4";
  const isAudioFirst = magic === "EOX4";
  const frame = view.getUint32(4, true);
  const width = view.getUint32(8, true);
  const height = view.getUint32(12, true);
  const cpuCycles = view.getUint32(16, true);
  const cpuSteps = view.getUint32(20, true);
  const frameMs = view.getUint32(24, true) / 1000;
  const stopped = view.getUint32(28, true) !== 0;
  const sampleRate = view.getUint32(32, true);
  const sampleCount = view.getUint32(36, true);
  const videoLength = view.getUint32(40, true);
  const pcmLength = view.getUint32(44, true);
  const channels = hasChannels ? Math.max(1, view.getUint32(48, true)) : 1;
  const pcmOffset = isAudioFirst ? headerLength : headerLength + videoLength;
  const videoOffset = isAudioFirst ? headerLength + pcmLength : headerLength;
  const videoEnd = videoOffset + videoLength;
  const expectedVideoLength = isRgb565 ? width * height * 2 : width * height * 4;
  if (
    (videoLength !== 0 && videoLength !== expectedVideoLength) ||
    pcmLength !== sampleCount * channels * 2 ||
    bytes.byteLength !== headerLength + videoLength + pcmLength
  ) {
    throw new Error("EutherOxide frame/audio packet size mismatch");
  }
  const rgba = videoLength === 0
    ? new Uint8ClampedArray(0) as Uint8ClampedArray<ArrayBuffer>
    : deferVideo && isAudioFirst
      ? new Uint8ClampedArray(0) as Uint8ClampedArray<ArrayBuffer>
      : isRgb565
        ? decodeRgb565Frame(bytes.subarray(videoOffset, videoEnd), width, height)
        : bytes.subarray(videoOffset, videoEnd);
  return {
    frame: {
      frame,
      width,
      height,
      rgba,
      cpuCycles,
      cpuSteps,
      frameMs,
      stopped,
      lastError: null,
    },
    audio: {
      frame,
      sampleRate,
      samples: new Int16Array(buffer, pcmOffset, sampleCount * channels) as Int16Array<ArrayBuffer>,
      channels,
    },
    transport: isRgb565 ? "BRIDGE RGB565 PACKET" : "BRIDGE RGBA PACKET",
    videoFormat: videoLength === 0 ? "AUDIO_ONLY" : isAudioFirst ? "RGB565_AUDIO_FIRST" : isRgb565 ? "RGB565" : "RGBA",
    videoBytes: deferVideo && isAudioFirst && videoLength > 0 ? bytes : undefined,
    videoOffset: deferVideo && isAudioFirst && videoLength > 0 ? videoOffset : undefined,
    videoLength: deferVideo && isAudioFirst && videoLength > 0 ? videoLength : undefined,
  };
}

function finishDeferredVideoFrame(packet: DecodedFrameAudioPacket): void {
  if (
    packet.videoFormat !== "RGB565_AUDIO_FIRST" ||
    !packet.videoBytes ||
    packet.videoOffset === undefined ||
    packet.videoLength === undefined
  ) {
    return;
  }
  packet.frame.rgba = decodeRgb565Frame(
    packet.videoBytes.subarray(packet.videoOffset, packet.videoOffset + packet.videoLength),
    packet.frame.width,
    packet.frame.height,
  );
}

function decodeRgb565Frame(
  data: Uint8Array<ArrayBufferLike>,
  width: number,
  height: number,
): Uint8ClampedArray<ArrayBuffer> {
  const pixels = new Uint8ClampedArray(width * height * 4) as Uint8ClampedArray<ArrayBuffer>;
  let output = 0;
  for (let index = 0; index < data.byteLength; index += 2) {
    const value = data[index] | (data[index + 1] << 8);
    const r5 = (value >> 11) & 0x1f;
    const g6 = (value >> 5) & 0x3f;
    const b5 = value & 0x1f;
    pixels[output] = (r5 << 3) | (r5 >> 2);
    pixels[output + 1] = (g6 << 2) | (g6 >> 4);
    pixels[output + 2] = (b5 << 3) | (b5 >> 2);
    pixels[output + 3] = 255;
    output += 4;
  }
  return pixels;
}

function decodeBridgeAudio(buffer: ArrayBuffer): AudioResult {
  const bytes = new Uint8Array(buffer);
  const magic = String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0);
  const headerLength = magic === "EOA2" ? 20 : 16;
  if (
    bytes.length < headerLength ||
    (magic !== "EOXA" && magic !== "EOA2")
  ) {
    throw new Error("Bad EutherOxide audio packet");
  }
  const view = new DataView(buffer);
  const hasChannels = magic === "EOA2";
  const frame = view.getUint32(4, true);
  const sampleRate = view.getUint32(8, true);
  const count = view.getUint32(12, true);
  const channels = hasChannels ? Math.max(1, view.getUint32(16, true)) : 1;
  const pcmOffset = headerLength;
  if (bytes.byteLength !== pcmOffset + count * channels * 2) {
    throw new Error("EutherOxide audio packet size mismatch");
  }
  const samples = new Int16Array(buffer, pcmOffset, count * channels) as Int16Array<ArrayBuffer>;
  return { frame, sampleRate, samples, channels };
}

function decodeBridgeFrame(buffer: ArrayBuffer): FrameResult {
  const bytes = new Uint8Array(buffer);
  if (
    bytes.length < 32 ||
    bytes[0] !== 0x45 ||
    bytes[1] !== 0x4f ||
    bytes[2] !== 0x58 ||
    bytes[3] !== 0x46
  ) {
    throw new Error("Bad EutherOxide frame packet");
  }
  const view = new DataView(buffer);
  const width = view.getUint32(8, true);
  const height = view.getUint32(12, true);
  const rgba = bytes.subarray(32);
  if (rgba.byteLength !== width * height * 4) {
    throw new Error("EutherOxide frame packet size mismatch");
  }
  return {
    frame: view.getUint32(4, true),
    width,
    height,
    rgba,
    cpuCycles: view.getUint32(16, true),
    cpuSteps: view.getUint32(20, true),
    frameMs: view.getUint32(24, true) / 1000,
    stopped: view.getUint32(28, true) !== 0,
    lastError: null,
  };
}

async function bridgeRequest(
  path: string,
  init: RequestInit = {},
  timeoutMs = 0,
): Promise<Response> {
  const controller = timeoutMs > 0 ? new AbortController() : null;
  const timeout =
    controller && window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    const method = (init.method ?? "GET").toUpperCase();
    if (hostCsrfToken && !["GET", "HEAD", "OPTIONS"].includes(method) && !headers.has("X-CSRF-Token")) {
      headers.set("X-CSRF-Token", hostCsrfToken);
    }
    const response = await fetch(bridgeUrl(path), {
      ...init,
      headers,
      credentials: "include",
      signal: controller?.signal,
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    return response;
  } finally {
    if (timeout) {
      window.clearTimeout(timeout);
    }
  }
}

async function animationLoop(): Promise<void> {
  if (!ui.playing) {
    return;
  }
  const now = performance.now();
  if (now >= nextFrameDue - 1) {
    await advanceFrame();
    const frameMs = 1000 / (ui.timing === "PAL" ? 50 : 60);
    nextFrameDue += frameMs;
    if (nextFrameDue < performance.now() - frameMs) {
      nextFrameDue = performance.now();
    }
  }
  window.requestAnimationFrame(() => void animationLoop());
}

function stopBridgeStream(): void {
  bridgeStreamGeneration += 1;
  bridgeStreamAbort?.abort();
  bridgeStreamAbort = null;
  bridgeStreamActive = false;
  stopBridgeVideoStream();
  stopBridgeWebRtcProbe();
  resetScheduledAudio();
}

function stopBridgeFrameAudioStream(): void {
  bridgeStreamGeneration += 1;
  bridgeStreamAbort?.abort();
  bridgeStreamAbort = null;
  bridgeStreamActive = false;
  resetScheduledAudio();
}

function bridgeWebRtcMediaActive(): boolean {
  return bridgeWebRtcVideoActive && bridgeWebRtcAudioActive;
}

function resumeBridgeRtcAudio(): void {
  if (!bridgeRtcAudio.srcObject) {
    return;
  }
  applyAudioVolume();
  bridgeRtcAudio.play().catch(() => {
    pushTrace("WebRTC audio waiting");
  });
}

async function startBridgePlayback(): Promise<void> {
  if (bridgePlaybackStarting) {
    return;
  }
  bridgePlaybackStarting = true;
  ui.status = "SYNCING";
  ui.transportMode = "BRIDGE ARMING";
  renderUi();
  try {
    await ensureBridgePlayerSlot();
    stopBridgeStream();
    ui.playing = true;
    playToggle.textContent = "Pause";
    resetScheduledAudio();
    const probeStarted = await startBridgeWebRtcProbe();
    if (probeStarted && await waitForBridgeWebRtcMedia(2400)) {
      resumeBridgeRtcAudio();
      ui.status = "RUNNING";
      ui.transportMode = bridgeTransportLabel("BRIDGE WEBRTC");
      pushTrace("Bridge WebRTC startup synced");
      renderUi();
      return;
    }
    pushTrace("WebRTC startup fallback");
    if (!startBridgeVideoStream()) {
      void ensureAudio();
      void bridgeStreamLoop();
    }
  } catch (error) {
    ui.playing = false;
    playToggle.textContent = "Play";
    ui.status = "START FAIL";
    ui.lastError = error instanceof Error ? error.message : String(error);
    pushTrace(`Bridge startup failed: ${ui.lastError}`);
  } finally {
    bridgePlaybackStarting = false;
    renderUi();
  }
}

async function ensureBridgePlayerSlot(): Promise<void> {
  if (!hostedServerMode || lobbyRole === "spectator") {
    return;
  }
  await refreshAuthStatus();
  await refreshLobby();
  if (ownsCurrentSlot()) {
    return;
  }
  if (claimedLobbyPlayer !== null) {
    setPlayerPort(claimedLobbyPlayer);
    if (ownsCurrentSlot()) {
      return;
    }
  }
  if (hostPermissions.canPlay) {
    try {
      await joinLobbyInstance(playerPort);
    } catch {
      await joinLobbyInstance("auto");
    }
    return;
  }
  throw new Error("player slot required");
}

function waitForBridgeWebRtcMedia(timeoutMs: number): Promise<boolean> {
  if (bridgeWebRtcMediaActive()) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const started = performance.now();
    const timer = window.setInterval(() => {
      if (bridgeWebRtcMediaActive()) {
        window.clearInterval(timer);
        resolve(true);
        return;
      }
      if (performance.now() - started >= timeoutMs || bridgeWebRtcMode === "failed") {
        window.clearInterval(timer);
        resolve(false);
      }
    }, 50);
  });
}

function sendBridgeWebRtcHeartbeat(channel: RTCDataChannel): void {
  bridgeWebRtcLastPingAt = performance.now();
  ui.rtcLeaseStatus = lobbyRole === "spectator" ? "spectator" : `P${playerPort} ping`;
  channel.send("ping");
  renderUi();
}

function sendBridgeWebRtcInputSnapshot(): boolean {
  const channel = bridgeWebRtcChannel;
  if (
    !channel ||
    channel.readyState !== "open" ||
    lobbyRole === "spectator" ||
    !ownsCurrentSlot() ||
    ui.runtime !== "bridge" ||
    !ui.loaded
  ) {
    return false;
  }
  try {
    bridgeWebRtcInputSeq = (bridgeWebRtcInputSeq + 1) >>> 0;
    channel.send(JSON.stringify({
      type: "input",
      seq: bridgeWebRtcInputSeq,
      input: { ...inputState, player: playerPort },
    }));
    ui.inputStatus = `P${playerPort} dc`;
    return true;
  } catch {
    return false;
  }
}

function tuneBridgeWebRtcReceiver(receiver: RTCRtpReceiver): void {
  const lowLatencyReceiver = receiver as RTCRtpReceiver & {
    jitterBufferTarget?: number;
    playoutDelayHint?: number;
  };
  if ("jitterBufferTarget" in lowLatencyReceiver) {
    lowLatencyReceiver.jitterBufferTarget = 0;
  }
  if ("playoutDelayHint" in lowLatencyReceiver) {
    lowLatencyReceiver.playoutDelayHint = 0;
  }
}

function startBridgeWebRtcStats(peer: RTCPeerConnection, generation: number): void {
  if (bridgeWebRtcStatsTimer !== null) {
    window.clearInterval(bridgeWebRtcStatsTimer);
  }
  bridgeWebRtcLastVideoStats = null;
  bridgeWebRtcStatsTimer = window.setInterval(() => {
    if (generation !== bridgeWebRtcGeneration || peer.connectionState === "closed") {
      return;
    }
    void updateBridgeWebRtcStats(peer);
  }, 500);
}

function sendBridgeWebRtcVideoStats(stats: {
  droppedDelta: number;
  fps: number;
  jitterMs: number;
  queue: number;
  decodeMs: number;
}): void {
  const channel = bridgeWebRtcChannel;
  if (!channel || channel.readyState !== "open") {
    return;
  }
  try {
    channel.send(JSON.stringify({ type: "videoStats", stats }));
  } catch {
    // Stats feedback is opportunistic; media can continue without it.
  }
}

async function updateBridgeWebRtcStats(peer: RTCPeerConnection): Promise<void> {
  try {
    const stats = await peer.getStats();
    let foundVideo = false;
    stats.forEach((report) => {
      const entry = report as RTCStats & {
        type: string;
        kind?: string;
        mediaType?: string;
        jitterBufferDelay?: number;
        jitterBufferEmittedCount?: number;
        totalDecodeTime?: number;
        framesDecoded?: number;
        framesReceived?: number;
        framesDropped?: number;
      };
      if (
        entry.type !== "inbound-rtp" ||
        (entry.kind ?? entry.mediaType) !== "video"
      ) {
        return;
      }
      foundVideo = true;
      const emitted = entry.jitterBufferEmittedCount ?? 0;
      const jitter = entry.jitterBufferDelay ?? 0;
      const decoded = entry.framesDecoded ?? 0;
      const decode = entry.totalDecodeTime ?? 0;
      const dropped = entry.framesDropped ?? 0;
      const received = entry.framesReceived ?? decoded;
      const checkedAt = performance.now();
      const previous = bridgeWebRtcLastVideoStats;
      bridgeWebRtcLastVideoStats = { emitted, jitter, decoded, decode, dropped, received, checkedAt };
      if (!previous) {
        ui.videoAgeStatus = "measuring";
        return;
      }
      const emittedDelta = emitted - previous.emitted;
      const decodedDelta = decoded - previous.decoded;
      const droppedDelta = dropped - previous.dropped;
      const receivedDelta = received - previous.received;
      const secondsDelta = Math.max(0.001, (checkedAt - previous.checkedAt) / 1000);
      const jitterMs = emittedDelta > 0
        ? ((jitter - previous.jitter) / emittedDelta) * 1000
        : 0;
      const decodeMs = decodedDelta > 0
        ? ((decode - previous.decode) / decodedDelta) * 1000
        : 0;
      const fps = receivedDelta / secondsDelta;
      const queue = Math.max(0, received - decoded - dropped);
      sendBridgeWebRtcVideoStats({
        droppedDelta: Math.max(0, droppedDelta),
        fps,
        jitterMs: Math.max(0, jitterMs),
        queue,
        decodeMs: Math.max(0, decodeMs),
      });
      ui.videoAgeStatus = `jit ${Math.max(0, jitterMs).toFixed(0)}ms dec ${Math.max(0, decodeMs).toFixed(0)}ms q${queue} drop ${Math.max(0, droppedDelta)} fps ${fps.toFixed(0)}`;
    });
    if (!foundVideo) {
      ui.videoAgeStatus = "no video stats";
    }
    renderUi();
  } catch {
    ui.videoAgeStatus = "stats blocked";
    renderUi();
  }
}

async function startBridgeWebRtcProbe(): Promise<boolean> {
  if (isTauri) {
    return false;
  }
  const lanHttpWebRtcTrial = !window.isSecureContext && isPrivateLanHostname(currentHostname);
  if (!window.isSecureContext && !localWebHost && !lanHttpWebRtcTrial) {
    bridgeWebRtcMode = "blocked";
    pushTrace("WebRTC requires HTTPS");
    renderUi();
    return false;
  }
  if (lanHttpWebRtcTrial) {
    pushTrace("WebRTC LAN HTTP trial");
  }
  if (!window.RTCPeerConnection) {
    bridgeWebRtcMode = "failed";
    pushTrace("WebRTC unavailable");
    renderUi();
    return false;
  }
  const generation = bridgeWebRtcGeneration + 1;
  stopBridgeWebRtcProbe();
  bridgeWebRtcGeneration = generation;
  bridgeWebRtcMode = "connecting";
  const peer = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });
  bridgeWebRtcPeer = peer;
  const videoTransceiver = peer.addTransceiver("video", { direction: "recvonly" });
  const audioTransceiver = peer.addTransceiver("audio", { direction: "recvonly" });
  tuneBridgeWebRtcReceiver(videoTransceiver.receiver);
  tuneBridgeWebRtcReceiver(audioTransceiver.receiver);
  startBridgeWebRtcStats(peer, generation);
  peer.ontrack = (event) => {
    if (generation !== bridgeWebRtcGeneration) {
      return;
    }
    if (event.track.kind === "video") {
      stopBridgeVideoStream();
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      bridgeWebRtcVideoActive = true;
      bridgeVideo.srcObject = stream;
      syncBridgeVideoGeometry();
      screenGlass.classList.add("has-bridge-video");
      bridgeVideo.play().catch(() => {
        bridgeWebRtcVideoActive = false;
        screenGlass.classList.remove("has-bridge-video");
      });
      pushTrace("WebRTC video active");
      if (bridgeWebRtcMediaActive()) {
        stopBridgeFrameAudioStream();
        ui.transportMode = bridgeTransportLabel("BRIDGE WEBRTC");
      }
      renderUi();
      event.track.onended = () => {
        if (generation === bridgeWebRtcGeneration) {
          bridgeWebRtcVideoActive = false;
          bridgeVideo.srcObject = null;
          screenGlass.classList.remove("has-bridge-video");
          pushTrace("WebRTC video ended");
          renderUi();
        }
      };
      return;
    }
    if (event.track.kind === "audio") {
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      bridgeWebRtcAudioActive = true;
      bridgeRtcAudio.srcObject = stream;
      resumeBridgeRtcAudio();
      resetScheduledAudio();
      pushTrace("WebRTC audio active");
      if (bridgeWebRtcMediaActive()) {
        stopBridgeFrameAudioStream();
        ui.transportMode = bridgeTransportLabel("BRIDGE WEBRTC");
      }
      renderUi();
      event.track.onended = () => {
        if (generation === bridgeWebRtcGeneration) {
          bridgeWebRtcAudioActive = false;
          bridgeRtcAudio.srcObject = null;
          pushTrace("WebRTC audio ended");
          renderUi();
        }
      };
    }
  };
  const channel = peer.createDataChannel("eutheroxide-control", {
    ordered: false,
    maxRetransmits: 0,
  });
  bridgeWebRtcChannel = channel;

  channel.onopen = () => {
    if (generation !== bridgeWebRtcGeneration) {
      return;
    }
    bridgeWebRtcActive = true;
    bridgeWebRtcMode = "active";
    sendBridgeWebRtcHeartbeat(channel);
    if (bridgeWebRtcHeartbeatTimer !== null) {
      window.clearInterval(bridgeWebRtcHeartbeatTimer);
    }
    bridgeWebRtcHeartbeatTimer = window.setInterval(() => {
      if (
        generation !== bridgeWebRtcGeneration ||
        channel.readyState !== "open" ||
        lobbyRole === "spectator"
      ) {
        return;
      }
      sendBridgeWebRtcHeartbeat(channel);
    }, 2000);
    if (bridgeWebRtcInputTimer !== null) {
      window.clearInterval(bridgeWebRtcInputTimer);
    }
    bridgeWebRtcInputTimer = window.setInterval(() => {
      if (generation !== bridgeWebRtcGeneration || channel.readyState !== "open") {
        return;
      }
      if (ui.playing) {
        sendBridgeWebRtcInputSnapshot();
      }
    }, 50);
    pushTrace("WebRTC datachannel active");
    renderUi();
  };
  channel.onmessage = (event) => {
    if (generation !== bridgeWebRtcGeneration) {
      return;
    }
    const message = String(event.data);
    if (message === "pong") {
      bridgeWebRtcLastPongAt = performance.now();
      const rtt = bridgeWebRtcLastPingAt > 0
        ? Math.max(0, bridgeWebRtcLastPongAt - bridgeWebRtcLastPingAt)
        : 0;
      ui.rtcLeaseStatus = lobbyRole === "spectator"
        ? `spectator ${rtt.toFixed(0)}ms`
        : `P${playerPort} live ${rtt.toFixed(0)}ms`;
      renderUi();
      return;
    }
    if (message.startsWith("input-error:")) {
      const error = message.slice("input-error:".length);
      ui.inputStatus = `P${playerPort} miss`;
      ui.lastError = error;
      pushTrace(`WebRTC input missed: ${error}`);
      renderUi();
      return;
    }
    if (message.startsWith("video-fps:")) {
      pushTrace(`WebRTC video cap ${message.slice("video-fps:".length)} fps`);
      return;
    }
    pushTrace(`WebRTC ${message}`);
  };
  channel.onclose = () => {
    if (generation === bridgeWebRtcGeneration) {
      bridgeWebRtcActive = false;
      bridgeWebRtcMode = "idle";
      if (bridgeWebRtcHeartbeatTimer !== null) {
        window.clearInterval(bridgeWebRtcHeartbeatTimer);
        bridgeWebRtcHeartbeatTimer = null;
      }
      if (bridgeWebRtcInputTimer !== null) {
        window.clearInterval(bridgeWebRtcInputTimer);
        bridgeWebRtcInputTimer = null;
      }
      if (bridgeWebRtcStatsTimer !== null) {
        window.clearInterval(bridgeWebRtcStatsTimer);
        bridgeWebRtcStatsTimer = null;
      }
      bridgeWebRtcLastVideoStats = null;
      ui.rtcLeaseStatus = "closed";
      ui.videoAgeStatus = "closed";
      pushTrace("WebRTC datachannel closed");
      renderUi();
    }
  };

  try {
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    await waitForIceGathering(peer, 1800);
    if (!peer.localDescription || generation !== bridgeWebRtcGeneration) {
      return false;
    }
    const answer = await bridgeJson<RTCSessionDescriptionInit>(
      "/webrtc/offer",
      {
        method: "POST",
        body: JSON.stringify(peer.localDescription),
      },
      4500,
    );
    if (generation !== bridgeWebRtcGeneration) {
      return false;
    }
    await peer.setRemoteDescription(answer);
    return true;
  } catch {
    if (generation === bridgeWebRtcGeneration) {
      stopBridgeWebRtcProbe();
      bridgeWebRtcMode = "failed";
      pushTrace("WebRTC probe failed");
      renderUi();
    }
    return false;
  }
}

function stopBridgeWebRtcProbe(): void {
  bridgeWebRtcGeneration += 1;
  bridgeWebRtcActive = false;
  bridgeWebRtcVideoActive = false;
  bridgeWebRtcAudioActive = false;
  bridgeWebRtcLastPingAt = 0;
  bridgeWebRtcLastPongAt = 0;
  bridgeWebRtcLastVideoStats = null;
  ui.rtcLeaseStatus = "idle";
  ui.videoAgeStatus = "idle";
  if (bridgeVideo.srcObject) {
    bridgeVideo.srcObject = null;
    screenGlass.classList.remove("has-bridge-video");
  }
  if (bridgeRtcAudio.srcObject) {
    bridgeRtcAudio.srcObject = null;
  }
  bridgeWebRtcMode = "idle";
  if (bridgeWebRtcHeartbeatTimer !== null) {
    window.clearInterval(bridgeWebRtcHeartbeatTimer);
    bridgeWebRtcHeartbeatTimer = null;
  }
  if (bridgeWebRtcInputTimer !== null) {
    window.clearInterval(bridgeWebRtcInputTimer);
    bridgeWebRtcInputTimer = null;
  }
  if (bridgeWebRtcStatsTimer !== null) {
    window.clearInterval(bridgeWebRtcStatsTimer);
    bridgeWebRtcStatsTimer = null;
  }
  bridgeWebRtcInputSeq = 0;
  bridgeWebRtcChannel?.close();
  bridgeWebRtcChannel = null;
  bridgeWebRtcPeer?.close();
  bridgeWebRtcPeer = null;
}

function bridgeTransportLabel(label: string): string {
  if (bridgeWebRtcMediaActive()) {
    return `${label} + WEBRTC A/V`;
  }
  if (bridgeWebRtcVideoActive) {
    return `${label} + WEBRTC VIDEO`;
  }
  switch (bridgeWebRtcMode) {
    case "active":
      return `${label} + WEBRTC CTRL`;
    case "connecting":
      return `${label} + WEBRTC TRY`;
    case "blocked":
      return `${label} + WEBRTC NEEDS HTTPS`;
    case "failed":
      return `${label} + WEBRTC FAILED`;
    default:
      return label;
  }
}

function waitForIceGathering(peer: RTCPeerConnection, timeoutMs: number): Promise<void> {
  if (peer.iceGatheringState === "complete") {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timeout = window.setTimeout(done, timeoutMs);
    function done(): void {
      window.clearTimeout(timeout);
      peer.removeEventListener("icegatheringstatechange", onStateChange);
      resolve();
    }
    function onStateChange(): void {
      if (peer.iceGatheringState === "complete") {
        done();
      }
    }
    peer.addEventListener("icegatheringstatechange", onStateChange);
  });
}

function startBridgeVideoStream(): boolean {
  if (lobbyRole !== "spectator") {
    return false;
  }
  const mime = "video/mp4; codecs=\"avc1.42E01E\"";
  const mediaSourceCtor = window.MediaSource;
  if (!mediaSourceCtor?.isTypeSupported(mime)) {
    return false;
  }
  const generation = bridgeStreamGeneration;
  bridgeVideoActive = true;
  bridgeVideoAbort = new AbortController();
  if (bridgeVideoFallbackTimer !== null) {
    window.clearTimeout(bridgeVideoFallbackTimer);
    bridgeVideoFallbackTimer = null;
  }
  bridgeVideo.onloadeddata = () => {
    if (!bridgeVideoActive || generation !== bridgeStreamGeneration) {
      return;
    }
    syncBridgeVideoGeometry();
    screenGlass.classList.add("has-bridge-video");
    ui.transportMode = bridgeTransportLabel("BRIDGE H264 MSE");
    pushTrace("H.264 video stream active");
    renderUi();
  };
  bridgeVideo.ontimeupdate = () => {
    trimBridgeVideoLatency();
  };
  bridgeVideo.onerror = () => {
    fallbackBridgeVideoStream();
  };
  const mediaSource = new MediaSource();
  bridgeVideo.src = URL.createObjectURL(mediaSource);
  mediaSource.addEventListener("sourceopen", () => {
    const sourceBuffer = mediaSource.addSourceBuffer(mime);
    const queue: Uint8Array<ArrayBuffer>[] = [];
    let closed = false;
    const appendNext = () => {
      if (closed || sourceBuffer.updating || queue.length === 0) {
        return;
      }
      sourceBuffer.appendBuffer(queue.shift()!);
    };
    sourceBuffer.addEventListener("updateend", () => {
      trimBridgeVideoLatency(sourceBuffer);
      appendNext();
    });
    void (async () => {
      try {
        const response = await fetch(bridgeUrl("/stream-video.mp4"), {
          credentials: "include",
          signal: bridgeVideoAbort?.signal,
        });
        if (!response.ok || !response.body) {
          throw new Error(await response.text());
        }
        const reader = response.body.getReader();
        while (bridgeVideoActive && generation === bridgeStreamGeneration) {
          const read = await reader.read();
          if (read.done) {
            break;
          }
          if (read.value) {
            queue.push(read.value as Uint8Array<ArrayBuffer>);
            appendNext();
          }
        }
      } catch {
        if (bridgeVideoActive && generation === bridgeStreamGeneration) {
          fallbackBridgeVideoStream();
        }
      } finally {
        closed = true;
        if (mediaSource.readyState === "open") {
          try {
            mediaSource.endOfStream();
          } catch {
            // Source may already be closing after abort.
          }
        }
      }
    })();
  }, { once: true });
  bridgeVideo.play().catch(() => fallbackBridgeVideoStream());
  bridgeVideoFallbackTimer = window.setTimeout(() => {
    if (bridgeVideoActive && bridgeVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      fallbackBridgeVideoStream();
    }
  }, 2500);
  bridgeVideoLatencyTimer = window.setInterval(() => trimBridgeVideoLatency(), 500);
  ui.transportMode = bridgeTransportLabel("BRIDGE H264 MSE");
  return true;
}

function stopBridgeVideoStream(): void {
  if (bridgeVideoFallbackTimer !== null) {
    window.clearTimeout(bridgeVideoFallbackTimer);
    bridgeVideoFallbackTimer = null;
  }
  if (bridgeVideoLatencyTimer !== null) {
    window.clearInterval(bridgeVideoLatencyTimer);
    bridgeVideoLatencyTimer = null;
  }
  bridgeVideo.onloadeddata = null;
  bridgeVideo.ontimeupdate = null;
  bridgeVideo.onerror = null;
  bridgeVideoAbort?.abort();
  bridgeVideoAbort = null;
  if (bridgeWebRtcVideoActive && bridgeVideo.srcObject) {
    bridgeVideoActive = false;
    return;
  }
  if (!bridgeVideoActive && !bridgeVideo.src) {
    return;
  }
  bridgeVideoActive = false;
  bridgeVideo.pause();
  if (bridgeVideo.src.startsWith("blob:")) {
    URL.revokeObjectURL(bridgeVideo.src);
  }
  bridgeVideo.removeAttribute("src");
  bridgeVideo.load();
  screenGlass.classList.remove("has-bridge-video");
}

function trimBridgeVideoLatency(sourceBuffer?: SourceBuffer): void {
  if (!bridgeVideoActive || bridgeVideo.buffered.length === 0) {
    return;
  }
  const end = bridgeVideo.buffered.end(bridgeVideo.buffered.length - 1);
  const lag = end - bridgeVideo.currentTime;
  if (lag > 0.8) {
    bridgeVideo.currentTime = Math.max(0, end - 0.18);
    ui.transportMode = bridgeTransportLabel(`BRIDGE H264 LIVE ${lag.toFixed(1)}s`);
    renderUi();
  }
  const removeBefore = bridgeVideo.currentTime - 1.0;
  if (
    sourceBuffer &&
    !sourceBuffer.updating &&
    removeBefore > 0 &&
    bridgeVideo.buffered.length > 0 &&
    bridgeVideo.buffered.start(0) < removeBefore
  ) {
    try {
      sourceBuffer.remove(0, removeBefore);
    } catch {
      // Buffer trimming is opportunistic; playback can continue without it.
    }
  }
}

function fallbackBridgeVideoStream(): void {
  stopBridgeVideoStream();
  if (ui.playing && ui.runtime === "bridge") {
    void ensureAudio();
    void bridgeStreamLoop();
  }
}

async function bridgeStreamLoop(): Promise<void> {
  if (bridgeStreamActive || bridgeWebRtcMediaActive()) {
    resumeBridgeRtcAudio();
    return;
  }
  stopBridgeVideoStream();
  bridgeStreamActive = true;
  const generation = bridgeStreamGeneration;
  bridgeStreamAbort = new AbortController();
  const started = performance.now();
  let received = 0;
  let pending = new Uint8Array(0) as Uint8Array<ArrayBufferLike>;
  let rebondStream = false;
  try {
    const response = await bridgeStreamRequest(bridgeStreamAbort.signal);
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Bridge stream body unavailable");
    }
    pushTrace("Bridge stream bonded");
    while (generation === bridgeStreamGeneration && ui.playing && ui.runtime === "bridge") {
      const read = await reader.read();
      if (read.done) {
        break;
      }
      if (!read.value) {
        continue;
      }
      pending = appendBytes(pending, read.value);
      let latestFrameAudio: DecodedFrameAudioPacket | null = null;
      const audioBatch: AudioResult[] = [];
      let batchCount = 0;
      const before = performance.now();
      while (pending.byteLength >= 4) {
        const view = new DataView(pending.buffer, pending.byteOffset, pending.byteLength);
        const packetLength = view.getUint32(0, true);
        if (pending.byteLength < 4 + packetLength) {
          break;
        }
        const packet = pending.slice(4, 4 + packetLength);
        pending = pending.slice(4 + packetLength);
        if (generation !== bridgeStreamGeneration || !ui.playing || ui.runtime !== "bridge") {
          break;
        }
        const frameAudio = decodeBridgeFrameAudio(packet.buffer, true);
        if (frameAudio.videoFormat === "RGB565_AUDIO_FIRST") {
          audioBatch.push(frameAudio.audio);
        }
        latestFrameAudio = frameAudio;
        batchCount += 1;
        received += 1;
      }
      if (latestFrameAudio) {
        if (audioBatch.length > 0) {
          ui.audioLeadMs = await scheduleAudioBatch(audioBatch);
        }
        const hasFrameVideo = latestFrameAudio.frame.rgba.length > 0;
        if (hasFrameVideo) {
          finishDeferredVideoFrame(latestFrameAudio);
        }
        const decoded = performance.now();
        if (hasFrameVideo) {
          drawNativeFrame(latestFrameAudio.frame);
        }
        const drawn = performance.now();
        if (latestFrameAudio.videoFormat !== "RGB565_AUDIO_FIRST") {
          ui.audioLeadMs = await scheduleAudio(latestFrameAudio.audio);
        }
        ui.transportMode = bridgeTransportLabel(
          latestFrameAudio.videoFormat?.startsWith("RGB565") ? "BRIDGE RGB565 STREAM" : "BRIDGE STREAM",
        );
        ui.transportMs = received === batchCount ? decoded - started : decoded - before;
        ui.drawMs = hasFrameVideo ? drawn - decoded : 0;
        if (hasFrameVideo) {
          applyBridgeFrame(latestFrameAudio.frame);
        } else {
          ui.frame = latestFrameAudio.frame.frame;
          ui.cpuCycles = latestFrameAudio.frame.cpuCycles;
          ui.cpuSteps = latestFrameAudio.frame.cpuSteps;
          ui.frameMs = latestFrameAudio.frame.frameMs;
          ui.status = latestFrameAudio.frame.stopped ? "STOPPED" : "RUNNING";
          ui.lastError = "";
        }
        renderUi();
        if (latestFrameAudio.frame.stopped) {
          ui.playing = false;
          playToggle.textContent = "Play";
          pushTrace("CPU reached unsupported reaction");
          stopBridgeStream();
          return;
        }
      }
    }
  } catch (error) {
    if (ui.playing && ui.runtime === "bridge" && !bridgeRestarting) {
      ui.lastError = String(error);
      if (ui.lastError.toLowerCase().includes("busy")) {
        ui.playing = false;
        playToggle.textContent = "Play";
        ui.status = "BUSY";
        ui.transportMode = "VIEWER";
        resetScheduledAudio();
        pushTrace("Bridge player slot occupied");
        renderUi();
      } else {
        rebondStream = true;
        pushTrace("Bridge stream rebonding");
      }
    }
  } finally {
    if (generation === bridgeStreamGeneration) {
      bridgeStreamActive = false;
      bridgeStreamAbort = null;
      if (rebondStream && ui.playing && ui.runtime === "bridge" && !bridgeRestarting) {
        window.setTimeout(() => {
          if (
            generation === bridgeStreamGeneration &&
            ui.playing &&
            ui.runtime === "bridge" &&
            !bridgeWebRtcMediaActive()
          ) {
            void bridgeStreamLoop();
          }
        }, 180);
      }
    }
  }
}

function appendBytes(
  left: Uint8Array<ArrayBufferLike>,
  right: Uint8Array<ArrayBufferLike>,
): Uint8Array<ArrayBufferLike> {
  if (left.byteLength === 0) {
    return right;
  }
  const out = new Uint8Array(left.byteLength + right.byteLength);
  out.set(left, 0);
  out.set(right, left.byteLength);
  return out;
}

function applyBridgeFrame(frame: FrameResult): void {
  ui.frame = frame.frame;
  ui.cpuCycles = frame.cpuCycles;
  ui.cpuSteps = frame.cpuSteps;
  ui.frameMs = frame.frameMs;
  ui.status = frame.stopped ? "STOPPED" : ui.playing ? "RUNNING" : "STEPPED";
  ui.lastError = frame.lastError ?? "";
}

function applyNativeFrameStatus(frame: NativeFrameResult, transportMs: number): void {
  const drawStarted = performance.now();
  drawNativeFrame(frame);
  ui.transportMs = transportMs;
  ui.drawMs = performance.now() - drawStarted;
  ui.audioLeadMs = frame.audioLeadMs;
  ui.transportMode = frame.audioActive ? "TAURI RUST LOOP" : "TAURI RUST VIDEO";
  ui.frame = frame.frame;
  ui.width = frame.width;
  ui.height = frame.height;
  ui.cpuCycles = frame.cpuCycles;
  ui.cpuSteps = frame.cpuSteps;
  ui.frameMs = frame.frameMs;
  ui.status = frame.stopped ? "STOPPED" : ui.playing ? "RUNNING" : "STEPPED";
  ui.lastError = frame.lastError ?? "";
  if (frame.stopped) {
    ui.playing = false;
    playToggle.textContent = "Play";
    void invoke("set_native_running", { running: false });
    pushTrace("CPU reached unsupported reaction");
  }
}

async function nativeStatusLoop(): Promise<void> {
  if (nativeStatusPolling) {
    return;
  }
  nativeStatusPolling = true;
  try {
    while (ui.playing && isTauri && ui.runtime === "tauri" && ui.loaded) {
      const started = performance.now();
      const frame = await tauriNativeStatus();
      const done = performance.now();
      if (frame) {
        applyNativeFrameStatus(frame, done - started);
        renderUi();
      }
      const frameMs = frame ? 1000 / Math.max(1, frame.frameRate) : 16;
      await sleep(Math.max(8, Math.min(33, frameMs)));
    }
  } finally {
    nativeStatusPolling = false;
  }
}

async function advanceFrame(): Promise<void> {
  if (stepping) {
    return;
  }
  stepping = true;
  try {
    if (dogsMode) {
      await runDogsFrame();
    } else if (isTauri && ui.runtime === "tauri" && ui.loaded) {
      const fetchStart = performance.now();
      const frame = await tauriNativeFrame();
      const fetchDone = performance.now();
      applyNativeFrameStatus(frame, fetchDone - fetchStart);
    } else if (ui.runtime === "bridge") {
      const fetchStart = performance.now();
      const frameAudio =
        ui.runtime === "bridge"
          ? await bridgeFrameAudio()
          : null;
      const frame = frameAudio?.frame ?? await invoke<FrameResult>("run_frame");
      const fetchDone = performance.now();
      drawNativeFrame(frame);
      const drawDone = performance.now();
      if (frameAudio) {
        ui.audioLeadMs = await scheduleAudio(frameAudio.audio);
        ui.transportMode = frameAudio.transport;
      } else {
        ui.transportMode = "FRAME JSON";
        void queueNativeAudio();
      }
      ui.transportMs = fetchDone - fetchStart;
      ui.drawMs = drawDone - fetchDone;
      ui.frame = frame.frame;
      ui.cpuCycles = frame.cpuCycles;
      ui.cpuSteps = frame.cpuSteps;
      ui.frameMs = frame.frameMs;
      ui.status = frame.stopped ? "STOPPED" : ui.playing ? "RUNNING" : "STEPPED";
      ui.lastError = frame.lastError ?? "";
      if (frame.stopped) {
        ui.playing = false;
        playToggle.textContent = "Play";
        pushTrace("CPU reached unsupported reaction");
      }
    } else {
      ui.frame += 1;
      ui.cpuCycles = 488 * 262;
      ui.cpuSteps = Math.max(1, Math.floor(420 + ((romHash ^ ui.frame) & 0xff)));
      ui.frameMs = 16.67;
      ui.transportMs = 0;
      ui.drawMs = 0;
      ui.audioLeadMs = 0;
      ui.transportMode = "WEB SYNTH";
      ui.status = ui.playing ? "WEB RUN" : "WEB STEP";
      drawSyntheticFrame();
    }
  } finally {
    renderUi();
    stepping = false;
  }
}

async function queueNativeAudio(): Promise<void> {
  if (!ui.playing || !ui.loaded) {
    return;
  }
  try {
    const audio =
      ui.runtime === "bridge"
        ? await bridgeAudio()
        : isTauri && ui.runtime === "tauri"
          ? await invoke<AudioResult>("render_audio_frame")
          : null;
    if (audio) {
      ui.audioLeadMs = await scheduleAudio(audio);
    }
  } catch {
    pushTrace("Audio bridge warming");
  }
}

function readStoredVolume(): number {
  const stored = Number(localStorage.getItem(volumeStorageKey));
  return Number.isFinite(stored) ? clampVolume(stored) : 0.8;
}

function readStoredMicVolume(): number {
  const stored = Number(localStorage.getItem(micVolumeStorageKey));
  return Number.isFinite(stored) ? clampMicVolume(stored) : 1;
}

function readStoredUserTheme(): UserTheme {
  return normalizeUserTheme(localStorage.getItem(userThemeStorageKey) ?? "dark");
}

function readStoredUserSkin(): UserSkin {
  return normalizeUserSkin(localStorage.getItem(userSkinStorageKey) ?? "classic");
}

function normalizeUserTheme(value: string): UserTheme {
  return value === "light" || value === "royal-apothic" ? value : "dark";
}

function normalizeUserSkin(value: string): UserSkin {
  return value === "glass" || value === "arcade" || value === "custom" ? value : "classic";
}

function clampDoomMouseSensitivity(value: number): number {
  if (!Number.isFinite(value)) {
    return 2.2;
  }
  return Math.min(Math.max(value, 0.6), 4);
}

function readStoredDoomMouseSensitivity(): number {
  const stored = Number(localStorage.getItem(doomMouseSensitivityStorageKey));
  return Number.isFinite(stored) ? clampDoomMouseSensitivity(stored) : 2.2;
}

function currentUserPreferences(): UserPreferences {
  return {
    audioVolume,
    micVolume,
    doomMouseSensitivity,
    theme: userTheme,
    skin: userSkin,
    eutherbooksVoice: selectedEutherBooksVoice,
    eutherbooksCustomVoice: eutherBooksCustomVoicePrompt,
    eutherbooksLengthScale: eutherBooksLengthScale,
    eutherbooksNoiseScale: eutherBooksNoiseScale,
    eutherbooksNoiseW: eutherBooksNoiseW,
    eutherbooksSentenceSilence: eutherBooksSentenceSilence,
    eutherbooksCfgValue: eutherBooksCfgValue,
    eutherbooksInferenceTimesteps: eutherBooksInferenceTimesteps,
    eutherbooksMaxChunkChars: eutherBooksMaxChunkChars,
    eutherbooksSeed: eutherBooksSeed,
    eutherbooksModelBackend: selectedEutherBooksModelBackend,
    eutherbooksDotsGuidanceScale: eutherBooksDotsGuidanceScale,
    eutherbooksDotsSpeakerScale: eutherBooksDotsSpeakerScale,
    eutherbooksDotsNumSteps: eutherBooksDotsNumSteps,
    eutherbooksDotsMaxGenerateLength: eutherBooksDotsMaxGenerateLength,
    eutherbooksLastBookId: selectedEutherBookId ?? "",
    eutherbooksLastChapterIndex: selectedEutherBookChapterIndex,
    eutherbooksAutoGenerateNext: eutherBooksAutoGenerateNext,
    eutherbooksOwnVoiceSvPath: eutherBooksOwnVoiceSvPath,
    eutherbooksOwnVoiceSvPrompt: eutherBooksOwnVoiceSvPrompt,
    eutherbooksOwnVoiceSvLocked: eutherBooksOwnVoiceSvLocked,
    eutherbooksOwnVoiceEnPath: eutherBooksOwnVoiceEnPath,
    eutherbooksOwnVoiceEnPrompt: eutherBooksOwnVoiceEnPrompt,
    eutherbooksOwnVoiceEnLocked: eutherBooksOwnVoiceEnLocked,
  };
}

async function loadUserPreferences(): Promise<void> {
  if (
    isTauri ||
    !hostUsername ||
    userPreferencesLoadedFor === hostUsername ||
    userPreferencesLoadingFor === hostUsername
  ) {
    return;
  }
  const loadingFor = hostUsername;
  userPreferencesLoadingFor = loadingFor;
  try {
    const preferences = await bridgeJson<UserPreferences>("/api/user/preferences", {}, 900);
    if (hostUsername !== loadingFor) {
      return;
    }
    applyingUserPreferences = true;
    setAudioVolume(preferences.audioVolume, false);
    setMicVolume(preferences.micVolume, false);
    setDoomMouseSensitivity(preferences.doomMouseSensitivity, false);
    setUserTheme(normalizeUserTheme(preferences.theme ?? userTheme), false);
    setUserSkin(normalizeUserSkin(preferences.skin ?? userSkin), false);
    applyEutherBooksUserPreferences(preferences);
    applyingUserPreferences = false;
    userPreferencesLoadedFor = loadingFor;
    pushTrace(`Loaded settings for ${displayUserName(loadingFor)}`);
  } catch (err) {
    applyingUserPreferences = false;
    pushTrace(`Server settings unavailable: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    if (userPreferencesLoadingFor === loadingFor) {
      userPreferencesLoadingFor = null;
    }
  }
}

function applyEutherBooksUserPreferences(preferences: UserPreferences): void {
  const voice = preferences.eutherbooksVoice?.trim();
  if (voice) {
    selectedEutherBooksVoice = voice;
    localStorage.setItem("eutherbooks-voice", voice);
  }
  if (typeof preferences.eutherbooksCustomVoice === "string") {
    setEutherBooksCustomVoicePrompt(preferences.eutherbooksCustomVoice);
  }
  if (typeof preferences.eutherbooksModelBackend === "string") {
    selectedEutherBooksModelBackend = normalizeEutherBooksModelBackend(preferences.eutherbooksModelBackend);
    persistEutherBooksModelBackend();
  }
  normalizeSelectedEutherBooksVoice();
  const lastBookId = preferences.eutherbooksLastBookId?.trim();
  if (lastBookId) {
    selectedEutherBookId = lastBookId;
    localStorage.setItem("eutherbooks-last-book", lastBookId);
  }
  if (typeof preferences.eutherbooksLastChapterIndex === "number" && Number.isFinite(preferences.eutherbooksLastChapterIndex)) {
    selectedEutherBookChapterIndex = Math.max(0, Math.round(preferences.eutherbooksLastChapterIndex));
    localStorage.setItem("eutherbooks-last_chapter", String(selectedEutherBookChapterIndex));
  }
  if (typeof preferences.eutherbooksAutoGenerateNext === "boolean") {
    eutherBooksAutoGenerateNext = preferences.eutherbooksAutoGenerateNext;
    localStorage.setItem("eutherbooks-auto-generate-next", String(eutherBooksAutoGenerateNext));
  }
  applyEutherBooksOwnVoicePreferences(preferences);
  eutherBooksLengthScale = applyEutherBooksNumberPreference(
    "length_scale",
    preferences.eutherbooksLengthScale,
    eutherBooksLengthScale,
  );
  eutherBooksNoiseScale = applyEutherBooksNumberPreference(
    "noise_scale",
    preferences.eutherbooksNoiseScale,
    eutherBooksNoiseScale,
  );
  eutherBooksNoiseW = applyEutherBooksNumberPreference("noise_w", preferences.eutherbooksNoiseW, eutherBooksNoiseW);
  eutherBooksSentenceSilence = applyEutherBooksNumberPreference(
    "sentence_silence",
    preferences.eutherbooksSentenceSilence,
    eutherBooksSentenceSilence,
  );
  eutherBooksCfgValue = applyEutherBooksNumberPreference("cfg_value", preferences.eutherbooksCfgValue, eutherBooksCfgValue);
  eutherBooksInferenceTimesteps = applyEutherBooksNumberPreference(
    "inference_timesteps",
    preferences.eutherbooksInferenceTimesteps,
    eutherBooksInferenceTimesteps,
  );
  // Dots SOAR runs in fast audiobook mode by default; raise steps manually for quality tests.
  eutherBooksDotsGuidanceScale = 1.2;
  eutherBooksDotsSpeakerScale = 1.5;
  eutherBooksDotsNumSteps = 4;
  localStorage.setItem("eutherbooks-dots_guidance_scale", String(eutherBooksDotsGuidanceScale));
  localStorage.setItem("eutherbooks-dots_speaker_scale", String(eutherBooksDotsSpeakerScale));
  localStorage.setItem("eutherbooks-dots_num_steps", String(eutherBooksDotsNumSteps));
  localStorage.setItem("eutherbooks-dots_max_generate_length", String(eutherBooksDotsMaxGenerateLength));
  eutherBooksMaxChunkChars = applyEutherBooksNumberPreference(
    "max_chunk_chars",
    preferences.eutherbooksMaxChunkChars,
    eutherBooksMaxChunkChars,
  );
  eutherBooksSeed = applyEutherBooksNumberPreference("seed", preferences.eutherbooksSeed, eutherBooksSeed);
  renderBooksWindowIfActive();
}

function persistEutherBooksSelectionPreference(saveRemote = true): void {
  if (selectedEutherBookId) {
    localStorage.setItem("eutherbooks-last-book", selectedEutherBookId);
  } else {
    localStorage.removeItem("eutherbooks-last-book");
  }
  localStorage.setItem("eutherbooks-last_chapter", String(Math.max(0, Math.round(selectedEutherBookChapterIndex))));
  if (saveRemote) {
    scheduleUserPreferencesSave();
  }
}

function applyEutherBooksNumberPreference(key: string, value: number | undefined, fallback: number): number {
  const safeValue = value === undefined ? fallback : clampEutherBooksOption(key, value);
  localStorage.setItem(`eutherbooks-${key}`, String(safeValue));
  return safeValue;
}

function scheduleUserPreferencesSave(): void {
  if (isTauri || applyingUserPreferences || !hostUsername) {
    return;
  }
  if (userPreferencesSaveTimer !== null) {
    window.clearTimeout(userPreferencesSaveTimer);
  }
  userPreferencesSaveTimer = window.setTimeout(() => {
    userPreferencesSaveTimer = null;
    void saveUserPreferences();
  }, 450);
}

async function saveUserPreferences(): Promise<void> {
  if (isTauri || !hostUsername) {
    return;
  }
  try {
    await bridgeJson<UserPreferences>(
      "/api/user/preferences",
      {
        method: "POST",
        body: JSON.stringify(currentUserPreferences()),
      },
      1200,
    );
    userPreferencesLoadedFor = hostUsername;
  } catch (err) {
    pushTrace(`Settings save delayed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function parseEutherDogsManifest(toml: string, modules: Record<string, string>): Map<string, string> {
  const byRelativePath = new Map<string, string>();
  for (const [modulePath, url] of Object.entries(modules)) {
    byRelativePath.set(modulePath.replace(/^\.\.\/assets\/eutherdogs\//, ""), url);
  }

  const entries = new Map<string, string>();
  let section = "";
  for (const rawLine of toml.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }
    const valueMatch = line.match(/^([A-Za-z0-9_]+)\s*=\s*"([^"]+)"/);
    if (!valueMatch) continue;
    const [, key, relativePath] = valueMatch;
    const url = byRelativePath.get(relativePath);
    if (!url) continue;
    entries.set(`${section}.${key}`, url);
  }
  return entries;
}

function dogsAsset(section: string, key: string): string | null {
  if (dogsAssetMode === "2x") {
    const highres = dogsHighresAsset(section, key);
    if (highres) {
      return highres;
    }
  }
  return eutherDogsAssets.get(`${section}.${key}`) ?? null;
}

function dogsHighresAsset(section: string, key: string): string | null {
  return eutherDogsAssets.get(`highres.${section}.${key}`) ?? null;
}

function dogsTileAsset(tile: string): string | null {
  const tileMap: Record<string, [string, string]> = {
    floor: ["tiles.floor", "sterile_tile"],
    sterile_floor: ["tiles.floor", "sterile_tile"],
    neon_floor: ["tiles.floor", "neon_floor"],
    warning_floor: ["tiles.floor", "warning_floor"],
    fan_floor: ["tiles.floor", "fan_floor"],
    player_spawn_1: ["tiles.floor", "player_spawn_1"],
    player_spawn_2: ["tiles.floor", "player_spawn_2"],
    wall: ["tiles.walls", "pharmacy_wall"],
    door: ["tiles.walls", "security_glass_wall"],
    corrupt_med_cabinet: ["tiles.props", "corrupt_med_cabinet"],
    hacked_vending_unit: ["tiles.props", "hacked_vending_unit"],
    recall_crate: ["tiles.props", "recall_crate"],
    shipping_box: ["tiles.props", "shipping_box"],
    service_elevator: ["tiles.props", "service_elevator"],
    prescription: ["items", "prescription"],
    folder: ["items", "folder"],
    data_wafer: ["items", "data_wafer"],
    circuit_board: ["items", "circuit_board"],
    pill_sample: ["items", "pill_sample"],
    lab_coat_armor: ["items", "lab_coat_armor"],
    hazard_sleeves: ["items", "hazard_sleeves"],
    pill_splitter: ["items", "pill_splitter"],
    routine_directive: ["items", "routine_directive"],
    scorch_mark: ["sprites.effects", "scorch_mark"],
    spilled_syrup: ["sprites.effects", "spilled_syrup"],
  };
  const entry = tileMap[tile];
  return entry ? dogsAsset(entry[0], entry[1]) : null;
}

function dogsTileAt(frame: DogsCoreFrame, x: number, y: number): string {
  if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) return "void";
  return frame.tiles[y * frame.width + x] ?? "floor";
}

function dogsVisibilityAt(frame: DogsCoreFrame, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) return 0;
  return frame.visibility?.[y * frame.width + x] ?? 255;
}

function dogsPixelVisibility(frame: DogsCoreFrame, x: number, y: number): number {
  return dogsVisibilityAt(frame, Math.floor(x / frame.tileWidth), Math.floor(y / frame.tileHeight));
}

function dogsWallTile(tile: string): boolean {
  return tile === "wall" || tile === "door";
}

function dogsWallAsset(frame: DogsCoreFrame, x: number, y: number, tile: string): string | null {
  const up = dogsWallTile(dogsTileAt(frame, x, y - 1));
  const down = dogsWallTile(dogsTileAt(frame, x, y + 1));
  const left = dogsWallTile(dogsTileAt(frame, x - 1, y));
  const right = dogsWallTile(dogsTileAt(frame, x + 1, y));
  const prefix = tile === "door" ? "security_glass_wall" : "pharmacy_wall";
  const horizontalRun = left || right;
  const verticalRun = up || down;
  const cornerAsset = (suffix: string): string | null => (
    dogsAsset("tiles.walls", `${prefix}_corner_${suffix}`)
      ?? dogsAsset("tiles.walls", `${prefix}_junction`)
      ?? dogsAsset("tiles.walls", prefix)
  );
  if (up && right && !down && !left) {
    return cornerAsset("up_right");
  }
  if (up && left && !down && !right) {
    return cornerAsset("up_left");
  }
  if (down && right && !up && !left) {
    return cornerAsset("down_right");
  }
  if (down && left && !up && !right) {
    return cornerAsset("down_left");
  }
  if (horizontalRun && verticalRun) {
    return dogsAsset("tiles.walls", `${prefix}_junction`) ?? dogsAsset("tiles.walls", prefix);
  }
  if (verticalRun && !horizontalRun) {
    return dogsAsset("tiles.walls", `${prefix}_column`) ?? dogsAsset("tiles.walls", prefix);
  }
  if (!verticalRun && !horizontalRun) {
    return dogsAsset("tiles.walls", `${prefix}_column`) ?? dogsAsset("tiles.walls", prefix);
  }
  if (horizontalRun && !down) {
    return dogsAsset("tiles.walls", `${prefix}_face`);
  }
  if (horizontalRun && !up) {
    return dogsAsset("tiles.walls", `${prefix}_cap`);
  }
  return dogsAsset("tiles.walls", prefix);
}

function dogsTileImageFit(tile: string): "contain" | "cover" {
  if (
    tile === "floor"
    || tile === "sterile_floor"
    || tile === "neon_floor"
    || tile === "warning_floor"
    || tile === "fan_floor"
    || tile === "player_spawn_1"
    || tile === "player_spawn_2"
  ) {
    return "cover";
  }
  return "contain";
}

function drawDogsVisibleTiles(
  frame: DogsCoreFrame,
  cameraX: number,
  cameraY: number,
  scale: number,
  yScale: number,
  firstTileX: number,
  firstTileY: number,
  lastTileX: number,
  lastTileY: number,
  exitReady: boolean,
  visualFrame: number,
): void {
  const baseFloorAsset = dogsAsset("tiles.floor", "sterile_tile");
  for (let y = firstTileY; y <= lastTileY; y += 1) {
    for (let x = firstTileX; x <= lastTileX; x += 1) {
      const tile = frame.tiles[y * frame.width + x] ?? "floor";
      const tileX = Math.floor((x * frame.tileWidth - cameraX) * scale);
      const tileY = Math.floor((y * frame.tileHeight - cameraY) * yScale * scale);
      const tileW = Math.ceil(frame.tileWidth * scale);
      const tileH = Math.ceil(frame.tileHeight * yScale * scale);
      const asset = dogsWallTile(tile) ? dogsWallAsset(frame, x, y, tile) : dogsTileAsset(tile);
      drawDogsImage(baseFloorAsset, tileX, tileY, tileW, tileH, eutherDogsTileFallbackColors.floor, "cover");
      if (tile === "spilled_syrup") {
        drawDogsVentFan(tileX, tileY, tileW, tileH, visualFrame);
      } else {
        drawDogsImage(
          asset,
          tileX,
          tileY,
          tileW,
          tileH,
          eutherDogsTileFallbackColors[tile] ?? "#65716b",
          dogsTileImageFit(tile),
        );
      }
      if (tile === "service_elevator") {
        drawDogsExitPortal(tileX, tileY, tileW, tileH, exitReady, visualFrame);
      }
    }
  }
  dogsContext.fillStyle = "rgba(0, 0, 0, 0.32)";
  for (let y = firstTileY; y <= lastTileY; y += 1) {
    for (let x = firstTileX; x <= lastTileX; x += 1) {
      const tile = frame.tiles[y * frame.width + x] ?? "floor";
      if (!dogsWallTile(tile) || dogsWallTile(dogsTileAt(frame, x, y + 1))) continue;
      const shadowX = Math.floor((x * frame.tileWidth - cameraX + 3) * scale);
      const shadowY = Math.floor(((y + 1) * frame.tileHeight - cameraY - 3) * yScale * scale);
      const shadowW = Math.ceil((frame.tileWidth - 4) * scale);
      const shadowH = Math.max(2, Math.ceil(7 * scale));
      dogsContext.fillRect(shadowX, shadowY, shadowW, shadowH);
    }
  }
}

function dogsQueueLeft(frame: DogsCoreFrame | null | undefined): number {
  if (!frame) return 0;
  if (frame.summary.bossActive) {
    dogsSawHostileQueue = true;
    return 1;
  }
  let hostileTotal = 0;
  let hostileAlive = 0;
  for (const actor of frame.characters) {
    if (actor.faction !== "hostile_customer") {
      continue;
    }
    hostileTotal += 1;
    if (actor.alive) {
      hostileAlive += 1;
    }
  }
  if (hostileTotal > 0) {
    dogsSawHostileQueue = true;
    return hostileAlive;
  }
  return dogsSawHostileQueue ? 0 : frame.summary.targetsLeft;
}

function dogsExitReadyForQueue(frame: DogsCoreFrame, queueLeft: number): boolean {
  return (
    frame.summary.status === "won" ||
    (frame.summary.status === "running" &&
      queueLeft <= 0 &&
      frame.summary.objectsLeft <= 0 &&
      frame.summary.kills >= frame.summary.minimumKills)
  );
}

function dogsExitReady(frame: DogsCoreFrame): boolean {
  return dogsExitReadyForQueue(frame, dogsQueueLeft(frame));
}

function dogsHeroOnExit(frame: DogsCoreFrame): boolean {
  const hero = dogsLocalPlayer(frame);
  if (!hero) return false;
  const left = hero.x;
  const right = hero.x + frame.characterWidth - 1;
  const top = hero.y;
  const bottom = hero.y + frame.characterHeight - 1;
  const centerX = hero.x + frame.characterWidth / 2;
  const centerY = hero.y + frame.characterHeight / 2;
  return [
    [centerX, centerY],
    [left, top],
    [right, top],
    [left, bottom],
    [right, bottom],
  ].some(([x, y]) => {
    const tileX = Math.floor(x / frame.tileWidth);
    const tileY = Math.floor(y / frame.tileHeight);
    return dogsTileAt(frame, tileX, tileY) === "service_elevator";
  });
}

function dogsHeroKey(actor: DogsCoreActor, animated: boolean): string {
  const key = actor.sprite && dogsAsset("sprites.heroes", actor.sprite)
    ? actor.sprite
    : actor.id === 1
      ? "neon_pharmacist"
      : "night_shift_tech";
  return animated ? `${key}_walk` : key;
}

function dogsEnemyKey(actor: DogsCoreActor): string {
  const enemies = [
    "angry_customer",
    "claim_denier",
    "inventory_drone",
    "recall_enforcer",
    "black_market_courier",
    "district_manager",
    "inspector_cyan",
    "inspector_magenta",
    "senior_lma",
    "mpa_agent",
    "mpa_chief",
  ];
  return actor.sprite && dogsAsset("sprites.enemies", actor.sprite) ? actor.sprite : enemies[actor.id % enemies.length];
}

function dogsActorAsset(actor: DogsCoreActor): string | null {
  if (actor.faction === "player") {
    return dogsAsset("sprites.heroes", dogsHeroKey(actor, false));
  }
  return dogsAsset("sprites.enemies", dogsEnemyKey(actor));
}

function dogsActorSheetAsset(actor: DogsCoreActor): string | null {
  if (actor.faction !== "player") {
    const key = `${dogsEnemyKey(actor)}_walk`;
    if (dogsAssetMode === "2x" && !dogsHighresAsset("sprites.enemies", key)) {
      return null;
    }
    return dogsAsset("sprites.enemies", key);
  }
  const key = dogsHeroKey(actor, true);
  if (dogsAssetMode === "2x" && !dogsHighresAsset("sprites.heroes", key)) {
    return null;
  }
  return dogsAsset("sprites.heroes", key);
}

function dogsActorDirectionFacing(actor: DogsCoreActor): DogsActorFacing {
  switch (actor.direction) {
    case "up":
    case "up_left":
    case "up_right":
      return "up";
    case "left":
    case "down_left":
      return "left";
    case "right":
    case "down_right":
      return "right";
    default:
      return "down";
  }
}

function dogsFacingFromMovement(dx: number, dy: number, fallback: DogsActorFacing): DogsActorFacing {
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx < 0 ? "left" : "right";
  }
  if (Math.abs(dy) > 0) {
    return dy < 0 ? "up" : "down";
  }
  return fallback;
}

function dogsActorFacingRow(facing: DogsActorFacing): number {
  switch (facing) {
    case "up":
      return 3;
    case "left":
      return 1;
    case "right":
      return 2;
    case "down":
    default:
      return 0;
  }
}

const dogsProjectileStyles: Record<string, DogsProjectileStyle> = {
  scanner_blaster: { asset: "cyan_rx_bolt", color: "#39f7c8", size: 13, trail: 14, glow: 12, impact: 18 },
  coupon_pistol: { asset: "red_denial_bolt", color: "#ff4b4b", size: 10, trail: 7, glow: 5, impact: 10 },
  receipt_gun: { asset: "red_denial_bolt", color: "#ffb35c", size: 9, trail: 18, glow: 7, impact: 9 },
  rx_cannon: { asset: "power_pill", color: "#fff04a", size: 22, trail: 28, glow: 28, impact: 42, spins: true },
  label_printer: { asset: "label_shred", color: "#f2f7ff", size: 11, trail: 20, glow: 5, impact: 8, spins: true },
  sterilizer_spray: { asset: "sterilizer_cloud", color: "#7dfff1", size: 26, trail: 8, glow: 18, impact: 36 },
  capsule_launcher: { asset: "capsule_grenade", color: "#ffde5a", size: 18, trail: 20, glow: 20, impact: 48, spins: true },
  neon_prior_auth: { asset: "green_auth_laser", color: "#42ff74", size: 12, trail: 34, glow: 16, impact: 14 },
  turbo_prior_auth: { asset: "yellow_warning_laser", color: "#ffee63", size: 10, trail: 42, glow: 18, impact: 16 },
  formulary_zapper: { asset: "zapper_arc", color: "#ad7cff", size: 20, trail: 18, glow: 26, impact: 38 },
  autoinjector: { asset: "injector_dart", color: "#ff79c8", size: 13, trail: 13, glow: 8, impact: 16 },
  needlegun: { asset: "needle_stream", color: "#d5f7ff", size: 8, trail: 32, glow: 5, impact: 8 },
  handsanitizer_flamethrower: { asset: "sanitizer_flame", color: "#ff7a24", size: 30, trail: 9, glow: 28, impact: 44 },
  compliance_laser: { asset: "compliance_laser", color: "#54ff70", size: 16, trail: 58, glow: 24, impact: 20 },
};

function dogsProjectileStyle(weapon: string): DogsProjectileStyle {
  return dogsProjectileStyles[weapon] ?? dogsProjectileStyles.scanner_blaster;
}

function dogsProjectileAsset(bullet: DogsCoreBullet): string | null {
  return dogsAsset("sprites.projectiles", dogsProjectileStyle(bullet.weapon).asset);
}

function dogsEffectAsset(frameIndex: number): string | null {
  return dogsAsset("sprites.effects", `explosion_0${Math.min(5, Math.max(1, frameIndex))}`);
}

function dogsWeaponAsset(weapon: string | null | undefined): string | null {
  return weapon ? dogsAsset("sprites.weapons", weapon) : null;
}

function dogsSfxAsset(sound: string | null | undefined): string | null {
  return sound ? dogsAsset("audio.sfx", sound) : null;
}

function dogsMusicAsset(track: string | null | undefined): string | null {
  return track ? dogsAsset("audio.music", track) : null;
}

function dogsMissionMusicKey(mission: number | null | undefined): string {
  const normalized = Math.min(10, Math.max(1, Math.trunc(Number(mission) || 1)));
  return `mission_${String(normalized).padStart(2, "0")}`;
}

function dogsWeaponIconMarkup(weapon: string | null | undefined, label: string): string {
  const url = dogsWeaponAsset(weapon);
  return url
    ? `<img class="eutherdogs-weapon-icon" src="${url}" alt="${label}" />`
    : `<span class="eutherdogs-weapon-icon is-empty" aria-hidden="true"></span>`;
}

function dogsStoreItemIconMarkup(item: DogsStoreItem): string {
  const url = item.weapon
    ? dogsWeaponAsset(item.weapon)
    : item.armor > 0
      ? dogsAsset("items", "lab_coat_armor")
      : null;
  return url
    ? `<img class="eutherdogs-weapon-icon" src="${url}" alt="${item.label}" />`
    : `<span class="eutherdogs-weapon-icon is-empty" aria-hidden="true"></span>`;
}

function dogsStaffAsset(staff: DogsStaffOption): string | null {
  return dogsAsset("sprites.heroes", staff.character);
}

function dogsStaffSpriteMarkup(staff: DogsStaffOption): string {
  const url = dogsStaffAsset(staff);
  return url
    ? `<img class="eutherdogs-staff-sprite" src="${url}" alt="${staff.name}" />`
    : `<span class="eutherdogs-staff-sprite is-empty" aria-hidden="true"></span>`;
}

function dogsCharacterName(character: DogsCharacterKey): string {
  return dogsStaffOptions.find((staff) => staff.character === character)?.name ?? "Night Tech";
}

function scheduleDogsImageRedraw(): void {
  if (dogsDeferredImageRedraw || !dogsMode || !dogsFrame) {
    return;
  }
  dogsDeferredImageRedraw = true;
  window.requestAnimationFrame(() => {
    dogsDeferredImageRedraw = false;
    if (dogsMode && dogsFrame) {
      drawDogsFrame(dogsFrame);
    }
  });
}

function dogsImageForUrl(url: string): HTMLImageElement {
  let image = dogsImageCache.get(url);
  if (!image) {
    image = new Image();
    image.decoding = "async";
    image.src = url;
    dogsImageCache.set(url, image);
  }
  if (image.onload !== scheduleDogsImageRedraw) {
    image.onload = scheduleDogsImageRedraw;
  }
  return image;
}

function drawDogsImageOnContext(
  context: CanvasRenderingContext2D,
  url: string | null,
  x: number,
  y: number,
  width: number,
  height: number,
  fallbackColor: string,
  fit: "stretch" | "contain" | "cover" = "stretch",
  fillBackground = false,
): void {
  if (width <= 0 || height <= 0) {
    return;
  }
  if (!url) {
    context.fillStyle = fallbackColor;
    context.fillRect(x, y, width, height);
    return;
  }
  const image = dogsImageForUrl(url);
  if (image.complete && image.naturalWidth > 0) {
    if (fillBackground) {
      context.fillStyle = fallbackColor;
      context.fillRect(x, y, width, height);
    }
    if (fit === "stretch") {
      context.drawImage(image, x, y, width, height);
      return;
    }
    const sourceAspect = image.naturalWidth / image.naturalHeight;
    const targetAspect = width / height;
    const scaleByWidth = fit === "contain" ? sourceAspect > targetAspect : sourceAspect < targetAspect;
    const drawW = scaleByWidth ? width : height * sourceAspect;
    const drawH = scaleByWidth ? width / sourceAspect : height;
    context.drawImage(image, x + (width - drawW) / 2, y + (height - drawH) / 2, drawW, drawH);
  } else {
    context.fillStyle = fallbackColor;
    context.fillRect(x, y, width, height);
  }
}

function drawDogsImage(
  url: string | null,
  x: number,
  y: number,
  width: number,
  height: number,
  fallbackColor: string,
  fit: "stretch" | "contain" | "cover" = "stretch",
  fillBackground = false,
): void {
  drawDogsImageOnContext(dogsContext, url, x, y, width, height, fallbackColor, fit, fillBackground);
}

function drawDogsImageFrame(
  url: string | null,
  sourceX: number,
  sourceY: number,
  sourceWidth: number,
  sourceHeight: number,
  x: number,
  y: number,
  width: number,
  height: number,
  fallbackColor: string,
): boolean {
  if (!url) {
    drawDogsImage(null, x, y, width, height, fallbackColor);
    return false;
  }
  const image = dogsImageForUrl(url);
  if (image.complete && image.naturalWidth > 0) {
    dogsContext.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
    return true;
  } else {
    dogsContext.fillStyle = fallbackColor;
    dogsContext.fillRect(x, y, width, height);
    return false;
  }
}

function preloadDogsImage(url: string | null): void {
  if (!url || dogsImageCache.has(url)) return;
  const image = new Image();
  image.decoding = "async";
  image.onload = scheduleDogsImageRedraw;
  image.src = url;
  dogsImageCache.set(url, image);
}

async function preloadDogsImageDecoded(url: string | null): Promise<void> {
  if (!url) return;
  const cached = dogsImageCache.get(url);
  if (cached?.complete && cached.naturalWidth > 0) {
    await cached.decode?.().catch(() => undefined);
    warmDogsImageTexture(cached);
    return;
  }
  const pending = dogsImageLoadPromises.get(url);
  if (pending) {
    await pending;
    return;
  }
  const image = cached ?? new Image();
  if (!cached) {
    image.decoding = "async";
    image.onload = scheduleDogsImageRedraw;
    dogsImageCache.set(url, image);
  } else {
    image.onload = scheduleDogsImageRedraw;
  }
  const promise = new Promise<void>((resolve) => {
    if (image.complete) {
      resolve();
      return;
    }
    image.addEventListener("load", () => resolve(), { once: true });
    image.addEventListener("error", () => resolve(), { once: true });
    if (!image.src) {
      image.src = url;
    }
  })
    .then(() => image.decode?.().catch(() => undefined))
    .then(() => undefined)
    .finally(() => {
      dogsImageLoadPromises.delete(url);
    });
  dogsImageLoadPromises.set(url, promise);
  if (!image.src) {
    image.src = url;
  }
  await promise;
  warmDogsImageTexture(image);
}

function warmDogsImageTexture(image: HTMLImageElement): void {
  if (!dogsWarmupContext || !image.complete || image.naturalWidth <= 0) {
    return;
  }
  try {
    dogsWarmupContext.clearRect(0, 0, 1, 1);
    dogsWarmupContext.drawImage(image, 0, 0, 1, 1);
  } catch {
    // Texture warmup is opportunistic; rendering can still use the image fallback path.
  }
}

function dogsPreloadImageUrls(): string[] {
  const urls = new Set<string>();
  for (const [key, url] of eutherDogsAssets) {
    if (!/\.(png|jpg|jpeg|webp|svg)(\?|#|$)/i.test(url)) continue;
    if (key.startsWith("highres.")) {
      if (dogsAssetMode === "2x") {
        urls.add(url);
      }
      continue;
    }
    urls.add(url);
  }
  return Array.from(urls);
}

async function preloadDogsVisualAssets(force = false): Promise<void> {
  const audioKey = dogsPreloadAudioKey(selectedDogsMission);
  if (!force && dogsPreloadedAssetMode === dogsAssetMode && dogsPreloadedAudioKey === audioKey) return;
  const urls = dogsPreloadImageUrls();
  const audioUrls = dogsPreloadAudioUrls(selectedDogsMission);
  const total = urls.length + audioUrls.length;
  let loaded = 0;
  dogsPreloadProgress = { loaded: 0, total, label: "Reading RX asset manifest" };
  renderDogsPreloadOverlay();
  renderDogsMenu();
  let nextIndex = 0;
  const workerCount = Math.min(4, Math.max(1, urls.length));
  const decodeWorker = async () => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= urls.length) {
        return;
      }
      await preloadDogsImageDecoded(urls[index]);
      loaded += 1;
      dogsPreloadProgress = {
        loaded,
        total,
        label: "Decoding sprites and tiles",
      };
      renderDogsPreloadOverlay();
      renderDogsMenu();
      await sleep(0);
    }
  };
  await Promise.all(Array.from({ length: workerCount }, () => decodeWorker()));
  dogsPreloadProgress = {
    loaded,
    total,
    label: "Decoding gameplay SFX",
  };
  renderDogsPreloadOverlay();
  renderDogsMenu();
  await preloadDogsAudioAssets(audioUrls, (audioLoaded) => {
    loaded = urls.length + audioLoaded;
    dogsPreloadProgress = {
      loaded,
      total,
      label: "Decoding gameplay SFX",
    };
    renderDogsPreloadOverlay();
    renderDogsMenu();
  });
  dogsPreloadProgress = {
    loaded: total,
    total,
    label: "Cache warm",
  };
  renderDogsPreloadOverlay();
  renderDogsMenu();
  dogsPreloadedAssetMode = dogsAssetMode;
  dogsPreloadedAudioKey = audioKey;
  window.setTimeout(() => {
    dogsPreloadProgress = null;
    renderDogsPreloadOverlay();
    if (dogsMenuMode) {
      renderDogsMenu();
    }
  }, 250);
}

function preloadDogsCombatAssets(): void {
  for (const style of Object.values(dogsProjectileStyles)) {
    preloadDogsImage(dogsAsset("sprites.projectiles", style.asset));
  }
  for (let index = 1; index <= 5; index += 1) {
    preloadDogsImage(dogsEffectAsset(index));
  }
}

function dogsPreloadAudioKey(mission: number | null | undefined): string {
  return `${dogsAssetMode}:sfx:${dogsMissionMusicKey(mission)}`;
}

function dogsPreloadAudioUrls(mission: number | null | undefined = selectedDogsMission): string[] {
  void mission;
  const urls = new Set<string>();
  for (const [key, url] of eutherDogsAssets) {
    if (key.startsWith("audio.sfx.") && /\.(wav|ogg|mp3)(\?|#|$)/i.test(url)) {
      urls.add(url);
    }
  }
  return Array.from(urls);
}

async function preloadDogsAudioAssets(urls = dogsPreloadAudioUrls(), onProgress?: (loaded: number) => void): Promise<void> {
  const context = await ensureAudio();
  if (!context) return;
  let loaded = 0;
  let nextIndex = 0;
  const workerCount = Math.min(3, Math.max(1, urls.length));
  const audioWorker = async () => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= urls.length) {
        return;
      }
      const url = urls[index];
      const cache = url.includes("/audio/music/") ? dogsMusicCache : dogsSfxCache;
      if (!cache.has(url)) {
        await loadDogsAudioBuffer(url, cache, dogsAudioPreloadTimeoutMs);
      }
      loaded += 1;
      onProgress?.(loaded);
      await sleep(0);
    }
  };
  await Promise.all(Array.from({ length: workerCount }, () => audioWorker()));
}

async function loadDogsAudioBuffer(url: string, cache: Map<string, AudioBuffer>, timeoutMs = 0): Promise<AudioBuffer | null> {
  const cached = cache.get(url);
  if (cached) return cached;
  if (timeoutMs <= 0) {
    return await loadDogsAudioBufferUnbounded(url, cache);
  }
  const controller = new AbortController();
  let timedOut = false;
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await loadDogsAudioBufferUnbounded(url, cache, controller.signal);
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
    if (timedOut) {
      pushTrace(`EutherDogs audio preload skipped ${url.split("/").pop() ?? "audio"}`);
    }
  }
}

async function loadDogsAudioBufferUnbounded(
  url: string,
  cache: Map<string, AudioBuffer>,
  signal?: AbortSignal,
): Promise<AudioBuffer | null> {
  try {
    const context = await ensureAudio();
    if (!context) return null;
    const response = await fetch(url, { signal });
    const bytes = await response.arrayBuffer();
    if (signal?.aborted) return null;
    const buffer = await context.decodeAudioData(bytes.slice(0));
    if (signal?.aborted) return null;
    cache.set(url, buffer);
    return buffer;
  } catch {
    return null;
  }
}

function drawDogsProjectile(
  bullet: DogsCoreBullet,
  cameraX: number,
  cameraY: number,
  scale: number,
  yScale: number,
  frameTick: number,
): void {
  const style = dogsProjectileStyle(bullet.weapon);
  const cx = (bullet.x - cameraX) * scale;
  const cy = (bullet.y - cameraY) * yScale * scale;
  const size = Math.max(4, Math.ceil(style.size * scale));
  const velocity = Math.hypot(bullet.dx, bullet.dy) || 1;
  const ux = bullet.dx / velocity;
  const uy = bullet.dy / velocity;
  const trailLength = style.trail * scale;

  dogsContext.save();
  dogsContext.globalCompositeOperation = "lighter";
  dogsContext.strokeStyle = style.color;
  dogsContext.lineWidth = Math.max(1, Math.ceil(size * 0.22));
  dogsContext.globalAlpha = bullet.ownerFaction === "player" ? 0.7 : 0.52;
  dogsContext.beginPath();
  dogsContext.moveTo(cx - ux * trailLength, cy - uy * trailLength * yScale);
  dogsContext.lineTo(cx, cy);
  dogsContext.stroke();
  if (style.glow > 0) {
    const glow = dogsContext.createRadialGradient(cx, cy, 0, cx, cy, style.glow * scale);
    glow.addColorStop(0, style.color);
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    dogsContext.globalAlpha = bullet.ownerFaction === "player" ? 0.36 : 0.24;
    dogsContext.fillStyle = glow;
    dogsContext.fillRect(cx - style.glow * scale, cy - style.glow * scale, style.glow * 2 * scale, style.glow * 2 * scale);
  }
  dogsContext.restore();

  const url = dogsProjectileAsset(bullet);
  const image = url ? dogsImageCache.get(url) : null;
  if (url && image?.complete && image.naturalWidth > 0 && style.spins) {
    dogsContext.save();
    dogsContext.translate(cx, cy);
    dogsContext.rotate((frameTick * 0.22 + bullet.id) % (Math.PI * 2));
    dogsContext.drawImage(image, -size / 2, -size / 2, size, size);
    dogsContext.restore();
  } else {
    drawDogsImage(
      url,
      Math.floor(cx - size / 2),
      Math.floor(cy - size / 2),
      size,
      size,
      bullet.ownerFaction === "player" ? style.color : "#ff3030",
    );
  }
}

function updateDogsImpactEffects(frame: DogsCoreFrame): void {
  if (dogsLastImpactFrameProcessed === frame.frame) return;
  const current = new Map<number, DogsCoreBullet>();
  for (const bullet of frame.bullets) {
    current.set(bullet.id, bullet);
  }
  for (const [id, previous] of dogsTrackedBullets) {
    if (!current.has(id)) {
      dogsImpactEffects.push({
        id: `${frame.frame}:${id}`,
        x: previous.x,
        y: previous.y,
        weapon: previous.weapon,
        ownerFaction: previous.ownerFaction,
        startFrame: frame.frame,
      });
    }
  }
  dogsTrackedBullets = current;
  dogsImpactEffects = dogsImpactEffects.filter((effect) => frame.frame - effect.startFrame < 18);
  dogsLastImpactFrameProcessed = frame.frame;
}

function drawDogsImpactEffects(frame: DogsCoreFrame, cameraX: number, cameraY: number, scale: number, yScale: number): void {
  for (const effect of dogsImpactEffects) {
    const age = frame.frame - effect.startFrame;
    if (age < 0 || age >= 18) continue;
    if (effect.ownerFaction !== "player" && dogsPixelVisibility(frame, effect.x, effect.y) < 255) continue;
    const style = dogsProjectileStyle(effect.weapon);
    const cx = (effect.x - cameraX) * scale;
    const cy = (effect.y - cameraY) * yScale * scale;
    const pulse = Math.sin((age / 18) * Math.PI);
    const size = Math.max(8, Math.ceil((style.impact + pulse * style.impact * 0.45) * scale));
    const frameIndex = Math.min(5, Math.floor((age / 18) * 5) + 1);
    dogsContext.save();
    dogsContext.globalCompositeOperation = "lighter";
    const glow = dogsContext.createRadialGradient(cx, cy, 0, cx, cy, size * 0.62);
    glow.addColorStop(0, style.color);
    glow.addColorStop(0.35, `${style.color}88`);
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    dogsContext.globalAlpha = 0.42 * (1 - age / 20);
    dogsContext.fillStyle = glow;
    dogsContext.fillRect(cx - size, cy - size, size * 2, size * 2);
    dogsContext.restore();
    drawDogsImage(
      dogsEffectAsset(frameIndex),
      Math.floor(cx - size / 2),
      Math.floor(cy - size / 2),
      size,
      size,
      style.color,
    );
  }
}

function drawDogsExitPortal(x: number, y: number, width: number, height: number, active: boolean, tick: number): void {
  const cx = x + width / 2;
  const cy = y + height / 2;
  const radius = Math.max(4, Math.min(width, height) * (active ? 0.42 : 0.3));
  const pulse = (Math.sin(tick / (active ? 5 : 18)) + 1) / 2;
  dogsContext.save();
  dogsContext.globalCompositeOperation = "lighter";
  dogsContext.shadowColor = active ? "#b6ff2d" : "#46f7c8";
  dogsContext.shadowBlur = active ? 18 : 7;
  dogsContext.strokeStyle = active ? `rgba(190, 255, 45, ${0.72 + pulse * 0.24})` : `rgba(57, 247, 200, ${0.22 + pulse * 0.16})`;
  dogsContext.lineWidth = Math.max(1, width * 0.065);
  dogsContext.beginPath();
  dogsContext.ellipse(cx, cy, radius, radius * 0.7, tick / 16, 0.2, Math.PI * 1.62);
  dogsContext.stroke();
  dogsContext.strokeStyle = active ? `rgba(57, 247, 200, ${0.65 + pulse * 0.25})` : `rgba(255, 228, 60, ${0.2 + pulse * 0.12})`;
  dogsContext.lineWidth = Math.max(1, width * 0.04);
  dogsContext.beginPath();
  dogsContext.ellipse(cx, cy, radius * 0.62, radius * 0.42, -tick / 12, Math.PI * 0.35, Math.PI * 1.95);
  dogsContext.stroke();
  if (active) {
    const spokes = 5;
    for (let i = 0; i < spokes; i += 1) {
      const angle = tick / 10 + (Math.PI * 2 * i) / spokes;
      const px = cx + Math.cos(angle) * radius * 0.65;
      const py = cy + Math.sin(angle) * radius * 0.45;
      dogsContext.fillStyle = i % 2 === 0 ? "rgba(194, 255, 45, 0.85)" : "rgba(57, 247, 200, 0.75)";
      dogsContext.fillRect(px - width * 0.025, py - height * 0.025, width * 0.05, height * 0.05);
    }
  }
  dogsContext.restore();
}

function drawDogsVentFan(x: number, y: number, width: number, height: number, tick: number): void {
  const cx = x + width / 2;
  const cy = y + height / 2;
  const radius = Math.min(width, height) * 0.36;
  const bladeLength = radius * 0.95;
  const bladeWidth = Math.max(2, Math.min(width, height) * 0.12);
  const spin = tick / 7;
  dogsContext.save();
  dogsContext.fillStyle = "#aebcb7";
  dogsContext.fillRect(x, y, width, height);
  dogsContext.strokeStyle = "rgba(91, 110, 109, 0.7)";
  dogsContext.lineWidth = Math.max(1, Math.ceil(width * 0.025));
  for (let i = 1; i < 4; i += 1) {
    const gx = Math.floor(x + (width * i) / 4) + 0.5;
    dogsContext.beginPath();
    dogsContext.moveTo(gx, y);
    dogsContext.lineTo(gx, y + height);
    dogsContext.stroke();
  }
  for (let i = 1; i < 3; i += 1) {
    const gy = Math.floor(y + (height * i) / 3) + 0.5;
    dogsContext.beginPath();
    dogsContext.moveTo(x, gy);
    dogsContext.lineTo(x + width, gy);
    dogsContext.stroke();
  }
  dogsContext.fillStyle = "#718480";
  dogsContext.strokeStyle = "#2f3d3d";
  dogsContext.lineWidth = Math.max(1, Math.ceil(width * 0.04));
  dogsContext.beginPath();
  dogsContext.arc(cx, cy, radius * 1.08, 0, Math.PI * 2);
  dogsContext.fill();
  dogsContext.stroke();
  dogsContext.fillStyle = "#1d2728";
  dogsContext.beginPath();
  dogsContext.arc(cx, cy, radius * 0.86, 0, Math.PI * 2);
  dogsContext.fill();
  dogsContext.fillStyle = "#96aaa5";
  for (let i = 0; i < 4; i += 1) {
    dogsContext.save();
    dogsContext.translate(cx, cy);
    dogsContext.rotate(spin + (Math.PI * i) / 2);
    dogsContext.beginPath();
    dogsContext.ellipse(bladeLength * 0.42, 0, bladeLength * 0.52, bladeWidth, 0.2, 0, Math.PI * 2);
    dogsContext.fill();
    dogsContext.restore();
  }
  dogsContext.fillStyle = "#c8d4cf";
  dogsContext.beginPath();
  dogsContext.arc(cx, cy, Math.max(2, radius * 0.18), 0, Math.PI * 2);
  dogsContext.fill();
  dogsContext.restore();
}

function drawDogsVisibilityFog(
  frame: DogsCoreFrame,
  cameraX: number,
  cameraY: number,
  scale: number,
  yScale: number,
  firstTileX: number,
  firstTileY: number,
  lastTileX: number,
  lastTileY: number,
): void {
  dogsContext.save();
  const time = frame.frame / 38;
  for (let y = firstTileY; y <= lastTileY; y += 1) {
    for (let x = firstTileX; x <= lastTileX; x += 1) {
      const visibility = dogsVisibilityAt(frame, x, y);
      if (visibility >= 255) continue;
      const tileX = Math.floor((x * frame.tileWidth - cameraX) * scale);
      const tileY = Math.floor((y * frame.tileHeight - cameraY) * yScale * scale);
      const tileW = Math.ceil(frame.tileWidth * scale);
      const tileH = Math.ceil(frame.tileHeight * yScale * scale);
      const ripple = (Math.sin(x * 0.73 + y * 1.17 + time) + 1) * 0.5;
      if (visibility <= 0) {
        dogsContext.fillStyle = "#00040a";
        dogsContext.fillRect(tileX, tileY, tileW, tileH);
        const smoke = dogsContext.createRadialGradient(
          tileX + tileW * (0.25 + ripple * 0.48),
          tileY + tileH * (0.3 + (1 - ripple) * 0.34),
          0,
          tileX + tileW * 0.5,
          tileY + tileH * 0.5,
          Math.max(tileW, tileH) * 1.15,
        );
        smoke.addColorStop(0, `rgba(12, 32, 58, ${0.9 - ripple * 0.12})`);
        smoke.addColorStop(0.45, `rgba(4, 12, 28, ${0.94})`);
        smoke.addColorStop(1, "rgba(0, 4, 10, 1)");
        dogsContext.fillStyle = smoke;
        dogsContext.fillRect(tileX, tileY, tileW, tileH);
        dogsContext.strokeStyle = `rgba(39, 242, 255, ${0.035 + ripple * 0.018})`;
        dogsContext.strokeRect(tileX + 0.5, tileY + 0.5, Math.max(0, tileW - 1), Math.max(0, tileH - 1));
        continue;
      }
      const alpha = 0.48 + ripple * 0.12;
      dogsContext.fillStyle = `rgba(2, 13, 35, ${alpha})`;
      dogsContext.fillRect(tileX, tileY, tileW, tileH);
      const smoke = dogsContext.createRadialGradient(
        tileX + tileW * (0.35 + ripple * 0.3),
        tileY + tileH * 0.45,
        0,
        tileX + tileW * 0.5,
        tileY + tileH * 0.5,
        Math.max(tileW, tileH),
      );
      smoke.addColorStop(0, `rgba(72, 255, 225, ${0.05 + ripple * 0.025})`);
      smoke.addColorStop(0.55, `rgba(255, 42, 205, ${0.025 + ripple * 0.018})`);
      smoke.addColorStop(1, "rgba(0, 0, 0, 0)");
      dogsContext.fillStyle = smoke;
      dogsContext.fillRect(tileX, tileY, tileW, tileH);
    }
  }
  dogsContext.restore();
}

function dogsMapTileColor(tile: string, visibility: number): string {
  if (visibility <= 0) return "#02050a";
  if (dogsWallTile(tile)) return visibility >= 255 ? "#a6aeb2" : "#535a67";
  switch (tile) {
    case "corrupt_med_cabinet":
    case "hacked_vending_unit":
    case "recall_crate":
    case "shipping_box":
      return visibility >= 255 ? "#626b6a" : "#343a42";
    case "service_elevator":
      return "#c6ff35";
    case "player_spawn_1":
      return "#39f7c8";
    case "player_spawn_2":
      return "#ff5de1";
    case "prescription":
    case "folder":
    case "data_wafer":
    case "circuit_board":
    case "pill_sample":
      return "#ff5de1";
    case "lab_coat_armor":
    case "hazard_sleeves":
    case "pill_splitter":
      return "#ffe96d";
    case "scorch_mark":
    case "spilled_syrup":
      return visibility >= 255 ? "#2d3d43" : "#1a2330";
    default:
      return visibility >= 255 ? "#27313c" : "#171b2c";
  }
}

function drawDogsMapOverlay(frame: DogsCoreFrame, cameraX: number, cameraY: number, viewW: number, viewH: number): void {
  const margin = 34;
  const mapW = Math.min(dogsCanvas.width - margin * 2, frame.width * 7);
  const mapH = Math.min(dogsCanvas.height - margin * 2, frame.height * 7);
  const tileW = mapW / frame.width;
  const tileH = mapH / frame.height;
  const mapX = Math.floor((dogsCanvas.width - mapW) / 2);
  const mapY = Math.floor((dogsCanvas.height - mapH) / 2);

  dogsContext.save();
  dogsContext.fillStyle = "rgba(0, 0, 0, 0.86)";
  dogsContext.fillRect(0, 0, dogsCanvas.width, dogsCanvas.height);
  dogsContext.fillStyle = "rgba(44, 0, 58, 0.72)";
  dogsContext.fillRect(mapX - 12, mapY - 12, mapW + 24, mapH + 24);
  dogsContext.fillStyle = "#03070c";
  dogsContext.fillRect(mapX, mapY, mapW, mapH);

  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      const visibility = dogsVisibilityAt(frame, x, y);
      const tile = frame.tiles[y * frame.width + x] ?? "floor";
      dogsContext.fillStyle = dogsMapTileColor(tile, visibility);
      dogsContext.fillRect(
        Math.floor(mapX + x * tileW),
        Math.floor(mapY + y * tileH),
        Math.max(1, Math.ceil(tileW)),
        Math.max(1, Math.ceil(tileH)),
      );
    }
  }

  for (const actor of frame.characters) {
    if (!actor.alive || dogsPixelVisibility(frame, actor.x, actor.y) <= 0) continue;
    dogsContext.fillStyle = actor.faction === "player" ? "#39ffe6" : "#ff3b62";
    dogsContext.fillRect(
      Math.floor(mapX + (actor.x / frame.tileWidth) * tileW) - 2,
      Math.floor(mapY + (actor.y / frame.tileHeight) * tileH) - 2,
      4,
      4,
    );
  }

  const viewX = mapX + (cameraX / frame.tileWidth) * tileW;
  const viewY = mapY + (cameraY / frame.tileHeight) * tileH;
  const rectW = (viewW / frame.tileWidth) * tileW;
  const rectH = (viewH / frame.tileHeight) * tileH;
  dogsContext.strokeStyle = "#ffffff";
  dogsContext.lineWidth = 2;
  dogsContext.strokeRect(viewX, viewY, rectW, rectH);
  dogsContext.strokeStyle = "rgba(39, 242, 255, 0.55)";
  dogsContext.lineWidth = 1;
  dogsContext.strokeRect(mapX - 1, mapY - 1, mapW + 2, mapH + 2);
  dogsContext.restore();
}

function dogsLocalInspectionDialogue(frame: DogsCoreFrame): DogsInspectionDialogue | undefined {
  return (frame.inspectionDialogues ?? []).find((dialogue) => dialogue.player === playerPort);
}

function wrapDogsDialogueText(text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  dogsContext.font = "900 12px monospace";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && dogsContext.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 5);
}

function drawDogsInspectionDialogues(
  frame: DogsCoreFrame,
  cameraX: number,
  cameraY: number,
  scale: number,
  yScale: number,
): void {
  dogsInspectionAnswerRects = [];
  if (dogsMapOpen) return;
  const dialogue = dogsLocalInspectionDialogue(frame);
  if (!dialogue) return;
  const inspector = frame.characters.find((actor) => actor.id === dialogue.inspectorId && actor.alive);
  if (!inspector || dogsPixelVisibility(frame, inspector.x, inspector.y) < 255) return;

  const targetX = (inspector.x - cameraX + frame.characterWidth / 2) * scale;
  const targetY = (inspector.y - cameraY) * yScale * scale;
  const bubbleW = Math.min(330, Math.max(230, dogsCanvas.width * 0.48));
  const lines = wrapDogsDialogueText(dialogue.question, bubbleW - 28);
  const buttonH = dialogue.complete ? 0 : 24;
  const bubbleH = 34 + lines.length * 15 + (dialogue.complete ? 0 : buttonH + 10);
  const x = Math.max(8, Math.min(dogsCanvas.width - bubbleW - 8, targetX - bubbleW / 2));
  const y = Math.max(56, Math.min(dogsCanvas.height - bubbleH - 36, targetY - bubbleH - 14));

  dogsContext.save();
  dogsContext.fillStyle = "rgba(3, 9, 10, 0.94)";
  dogsContext.strokeStyle = dialogue.complete ? "#70ffe8" : "#ff405f";
  dogsContext.lineWidth = 1;
  dogsContext.shadowColor = dialogue.complete ? "#39f7c8" : "#ff305f";
  dogsContext.shadowBlur = 12;
  dogsContext.fillRect(x, y, bubbleW, bubbleH);
  dogsContext.strokeRect(x + 0.5, y + 0.5, bubbleW - 1, bubbleH - 1);
  dogsContext.shadowBlur = 0;
  dogsContext.fillStyle = dialogue.complete ? "#a7f7d0" : "#ff9aad";
  dogsContext.font = "900 10px monospace";
  dogsContext.textAlign = "left";
  dogsContext.textBaseline = "top";
  dogsContext.fillText("INSPECTOR QUERY", x + 12, y + 10);
  dogsContext.fillStyle = "#ecffe4";
  dogsContext.font = "900 12px monospace";
  lines.forEach((line, index) => dogsContext.fillText(line, x + 12, y + 28 + index * 15));

  if (!dialogue.complete) {
    const labels: Array<["yes" | "no" | "other", string]> = [["yes", "Y YES"], ["no", "N NO"], ["other", "O OTHER"]];
    const gap = 7;
    const buttonW = (bubbleW - 24 - gap * 2) / 3;
    const buttonY = y + bubbleH - buttonH - 10;
    for (const [index, [answer, label]] of labels.entries()) {
      const buttonX = x + 12 + index * (buttonW + gap);
      dogsContext.fillStyle = "rgba(255, 255, 255, 0.06)";
      dogsContext.strokeStyle = answer === "yes" ? "#70ffe8" : answer === "no" ? "#ff5f7a" : "#ffef7a";
      dogsContext.fillRect(buttonX, buttonY, buttonW, buttonH);
      dogsContext.strokeRect(buttonX + 0.5, buttonY + 0.5, buttonW - 1, buttonH - 1);
      dogsContext.fillStyle = "#ecffe4";
      dogsContext.textAlign = "center";
      dogsContext.fillText(label, buttonX + buttonW / 2, buttonY + 7);
      dogsInspectionAnswerRects.push({ answer, x: buttonX, y: buttonY, w: buttonW, h: buttonH });
    }
  }
  dogsContext.restore();
}

function drawDogsInspectionOverlay(frame: DogsCoreFrame, viewW: number, viewH: number): void {
  if (frame.frame < dogsInspectionAlertStartFrame || frame.frame > dogsInspectionAlertUntilFrame) return;
  const elapsed = frame.frame - dogsInspectionAlertStartFrame;
  const external = dogsInspectionAlertTitle.startsWith("WARNING");
  const flashIndex = Math.floor(elapsed / (external ? 48 : 36));
  const flashFrame = elapsed % (external ? 48 : 36);
  if (!external && (flashIndex >= 3 || flashFrame >= 22)) return;
  const visibleFrameLimit = external ? 38 : 22;
  if (flashFrame >= visibleFrameLimit) return;
  const alpha =
    flashFrame < 5
      ? flashFrame / 5
      : flashFrame > visibleFrameLimit - 7
        ? (visibleFrameLimit - flashFrame) / 7
        : 1;
  dogsContext.save();
  dogsContext.globalAlpha = alpha;
  dogsContext.fillStyle = "rgba(110, 0, 8, 0.34)";
  dogsContext.fillRect(0, 0, viewW, viewH);
  dogsContext.textAlign = "center";
  dogsContext.textBaseline = "middle";
  dogsContext.font = `900 ${Math.max(28, Math.floor(viewW / (external ? 19 : 13)))}px "Arial Black", Impact, sans-serif`;
  dogsContext.lineWidth = Math.max(3, Math.floor(viewW / 160));
  dogsContext.strokeStyle = "rgba(0, 0, 0, 0.92)";
  dogsContext.fillStyle = flashIndex % 2 === 0 ? "#ff304f" : "#ffef6e";
  dogsContext.shadowColor = "#ff304f";
  dogsContext.shadowBlur = 26;
  dogsContext.strokeText(dogsInspectionAlertTitle, viewW / 2, viewH * 0.35);
  dogsContext.fillText(dogsInspectionAlertTitle, viewW / 2, viewH * 0.35);
  dogsContext.font = `900 ${Math.max(12, Math.floor(viewW / (external ? 48 : 42)))}px monospace`;
  dogsContext.fillStyle = "#ffffff";
  dogsContext.shadowBlur = 8;
  for (const [index, line] of dogsInspectionAlertSubtitle.split("\n").entries()) {
    dogsContext.fillText(line, viewW / 2, viewH * 0.46 + index * Math.max(16, viewW / 46));
  }
  dogsContext.restore();
}

function processDogsAudio(frame: DogsCoreFrame): void {
  const events = frame.audioEvents ?? [];
  for (const event of events) {
    if (event === "inspection_alarm") {
      triggerDogsInspectionAlert(frame);
      void playDogsInspectionSiren();
    } else if (event === "external_inspection_alarm") {
      triggerDogsExternalInspectionAlert(frame);
      void playDogsExternalInspectionSiren();
    } else if (event === "mpa_hum") {
      void playDogsMpaHum();
    } else {
      if (dogsShouldSuppressServerShotSfx(event)) {
        continue;
      }
      void playDogsSfx(event, dogsGameplaySfxGain(event));
    }
  }
  if (events.length === 0) {
    processDogsAudioFallback(frame, dogsPreviousAudioFrame);
  }
  processDogsImmediateShotFeedback(frame, dogsPreviousAudioFrame);
  const exitReady = dogsExitReady(frame);
  if (exitReady && !dogsLastExitReady) {
    void playDogsSfx("portal_ready");
  }
  if (frame.summary.status === "won" && dogsLastExitReady) {
    void playDogsSfx("portal_enter");
  } else if (frame.summary.status === "running" && frame.frame - dogsLastPortalHumFrame >= (exitReady ? 210 : 600)) {
    dogsLastPortalHumFrame = frame.frame;
    void playDogsSfx("portal_idle", exitReady ? 0.14 : 0.045);
  }
  dogsLastExitReady = exitReady;
  dogsPreviousAudioFrame = frame;
}

function dogsShouldSuppressServerShotSfx(sound: string): boolean {
  if (!dogsLastLocalShotSound || sound !== dogsLastLocalShotSound) {
    return false;
  }
  return performance.now() - dogsLastLocalShotAt < 140;
}

function playDogsLocalShotFeedback(): void {
  const hero = dogsFrame ? dogsLocalPlayer(dogsFrame) : undefined;
  const weaponSound = hero?.activeWeapon || "scanner_blaster";
  dogsLastLocalShotAt = performance.now();
  dogsLastLocalShotSound = weaponSound;
  if (!playDogsCachedSfxNow(weaponSound, 0.9)) {
    void loadDogsSfx(weaponSound);
  }
}

function processDogsImmediateShotFeedback(frame: DogsCoreFrame, previous: DogsCoreFrame | null): void {
  if (!previous || frame.summary.shotsFired <= previous.summary.shotsFired) return;
  if (frame.bullets.length > previous.bullets.length) return;
  const hero = dogsLocalPlayer(frame);
  if (!hero) return;
  const weaponSound = hero.activeWeapon || "scanner_blaster";
  if (!dogsShouldSuppressServerShotSfx(weaponSound)) {
    void playDogsSfx(weaponSound, 0.9);
  }
  const [dx, dy] = dogsDirectionVector(hero.direction);
  dogsImpactEffects.push({
    id: `${frame.frame}:instant-shot:${frame.summary.shotsFired}`,
    x: hero.x + frame.characterWidth / 2 + dx * frame.characterWidth * 0.9,
    y: hero.y + frame.characterHeight / 2 + dy * frame.characterHeight * 0.9,
    weapon: weaponSound,
    ownerFaction: "player",
    startFrame: frame.frame,
  });
}

function dogsDirectionVector(direction: string): [number, number] {
  switch (direction) {
    case "up":
      return [0, -1];
    case "down":
      return [0, 1];
    case "left":
      return [-1, 0];
    case "right":
      return [1, 0];
    case "up_left":
      return [-Math.SQRT1_2, -Math.SQRT1_2];
    case "up_right":
      return [Math.SQRT1_2, -Math.SQRT1_2];
    case "down_left":
      return [-Math.SQRT1_2, Math.SQRT1_2];
    case "down_right":
      return [Math.SQRT1_2, Math.SQRT1_2];
    default:
      return [0, 1];
  }
}

function processDogsAudioFallback(frame: DogsCoreFrame, previous: DogsCoreFrame | null): void {
  if (!previous) return;
  if (
    frame.summary.mission === 2 &&
    previous.summary.mission === 2 &&
    previous.summary.elapsedTicks < 900 &&
    frame.summary.elapsedTicks >= 900
  ) {
    triggerDogsInspectionAlert(frame);
    void playDogsInspectionSiren();
  }
  if (
    frame.summary.mission === 10 &&
    previous.summary.mission === 10 &&
    previous.summary.elapsedTicks < 900 &&
    frame.summary.elapsedTicks >= 900
  ) {
    triggerDogsExternalInspectionAlert(frame);
    void playDogsExternalInspectionSiren();
  }
  if (frame.summary.objectsCollected > previous.summary.objectsCollected || frame.summary.cash > previous.summary.cash) {
    void playDogsSfx("pickup_rx", 0.82);
  }
  if (frame.summary.kills > previous.summary.kills || dogsQueueLeft(frame) < dogsQueueLeft(previous)) {
    void playDogsSfx("customer_defeated", 0.95);
  } else if (frame.summary.hits > previous.summary.hits || frame.summary.damageTaken > previous.summary.damageTaken) {
    void playDogsSfx("impact_heavy", 0.9);
  }
}

function triggerDogsInspectionAlert(frame: DogsCoreFrame): void {
  dogsInspectionAlertStartFrame = frame.frame;
  dogsInspectionAlertUntilFrame = frame.frame + 108;
  dogsInspectionAlertTitle = "INSPECTION!!!";
  dogsInspectionAlertSubtitle = "RETAIL COMPLIANCE BREACH";
}

function triggerDogsExternalInspectionAlert(frame: DogsCoreFrame): void {
  dogsInspectionAlertStartFrame = frame.frame;
  dogsInspectionAlertUntilFrame = frame.frame + 210;
  dogsInspectionAlertTitle = "WARNING EXTERNAL INSPECTION!";
  dogsInspectionAlertSubtitle = "The Medical Product Agency have arrived.\nBrace yourself.";
}

async function playDogsInspectionSiren(): Promise<void> {
  try {
    const context = await ensureAudio();
    if (!context) return;
    const scheduleBurst = (startTime: number): void => {
      const alarmGain = context.createGain();
      alarmGain.gain.setValueAtTime(0.0001, startTime);
      alarmGain.gain.exponentialRampToValueAtTime(0.42, startTime + 0.03);
      alarmGain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.46);
      alarmGain.connect(audioGain ?? context.destination);
      let endedOscillators = 0;
      const makeOscillator = (offset: number): void => {
        const oscillator = context.createOscillator();
        oscillator.type = "sawtooth";
        oscillator.frequency.setValueAtTime(420 + offset, startTime);
        oscillator.frequency.linearRampToValueAtTime(980 + offset, startTime + 0.23);
        oscillator.frequency.linearRampToValueAtTime(360 + offset, startTime + 0.46);
        oscillator.connect(alarmGain);
        activeAudioSources.add(oscillator);
        oscillator.onended = () => {
          activeAudioSources.delete(oscillator);
          oscillator.disconnect();
          endedOscillators += 1;
          if (endedOscillators >= 2) {
            alarmGain.disconnect();
          }
        };
        oscillator.start(startTime);
        oscillator.stop(startTime + 0.5);
      };
      makeOscillator(0);
      makeOscillator(-14);
    };
    for (let index = 0; index < 3; index += 1) {
      scheduleBurst(context.currentTime + index * 0.62);
    }
  } catch {
    pushTrace("EutherDogs inspection siren skipped");
  }
}

async function playDogsExternalInspectionSiren(): Promise<void> {
  try {
    const context = await ensureAudio();
    if (!context) return;
    const scheduleWail = (startTime: number): void => {
      const alarmGain = context.createGain();
      alarmGain.gain.setValueAtTime(0.0001, startTime);
      alarmGain.gain.exponentialRampToValueAtTime(0.34, startTime + 0.08);
      alarmGain.gain.exponentialRampToValueAtTime(0.0001, startTime + 1.2);
      alarmGain.connect(audioGain ?? context.destination);
      let endedOscillators = 0;
      const makeOscillator = (offset: number): void => {
        const oscillator = context.createOscillator();
        oscillator.type = "sawtooth";
        oscillator.frequency.setValueAtTime(190 + offset, startTime);
        oscillator.frequency.linearRampToValueAtTime(620 + offset, startTime + 0.58);
        oscillator.frequency.linearRampToValueAtTime(180 + offset, startTime + 1.18);
        oscillator.connect(alarmGain);
        activeAudioSources.add(oscillator);
        oscillator.onended = () => {
          activeAudioSources.delete(oscillator);
          oscillator.disconnect();
          endedOscillators += 1;
          if (endedOscillators >= 3) {
            alarmGain.disconnect();
          }
        };
        oscillator.start(startTime);
        oscillator.stop(startTime + 1.22);
      };
      makeOscillator(0);
      makeOscillator(-9);
      makeOscillator(-23);
    };
    for (let index = 0; index < 3; index += 1) {
      scheduleWail(context.currentTime + index * 1.15);
    }
  } catch {
    pushTrace("EutherDogs external inspection siren skipped");
  }
}

async function playDogsMpaHum(): Promise<void> {
  try {
    const context = await ensureAudio();
    if (!context) return;
    const startTime = context.currentTime;
    const humGain = context.createGain();
    humGain.gain.setValueAtTime(0.0001, startTime);
    humGain.gain.exponentialRampToValueAtTime(0.08, startTime + 0.04);
    humGain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.7);
    humGain.connect(audioGain ?? context.destination);
    const oscillators: OscillatorNode[] = [];
    for (const [index, frequency] of [82, 123].entries()) {
      const oscillator = context.createOscillator();
      oscillator.type = index === 0 ? "sine" : "triangle";
      oscillator.frequency.setValueAtTime(frequency, startTime);
      oscillator.frequency.linearRampToValueAtTime(frequency + 9, startTime + 0.28);
      oscillator.frequency.linearRampToValueAtTime(frequency - 4, startTime + 0.68);
      oscillator.connect(humGain);
      activeAudioSources.add(oscillator);
      oscillator.onended = () => {
        activeAudioSources.delete(oscillator);
        oscillator.disconnect();
        if (oscillators.every((node) => !activeAudioSources.has(node))) {
          humGain.disconnect();
        }
      };
      oscillators.push(oscillator);
      oscillator.start(startTime);
      oscillator.stop(startTime + 0.72);
    }
  } catch {
    pushTrace("EutherDogs MPA hum skipped");
  }
}

function resolveDogsLocalExit(frame: DogsCoreFrame): boolean {
  if (frame.summary.status !== "running" || !dogsExitReady(frame) || !dogsHeroOnExit(frame)) {
    return false;
  }
  frame.summary.status = "won";
  void playDogsSfx("portal_enter");
  return true;
}

function dogsGameplaySfxGain(sound: string): number {
  if (sound === "portal_ready") return 0.95;
  if (sound === "customer_defeated" || sound === "impact_heavy") return 0.95;
  if (sound === "pickup_rx" || sound === "weapon_switch") return 0.82;
  return 0.88;
}

async function playDogsSfx(sound: string, gain = 0.55): Promise<void> {
  try {
    const url = dogsSfxAsset(sound);
    if (!url) return;
    const context = await ensureAudio();
    if (!context) return;
    const buffer = await loadDogsAudioBuffer(url, dogsSfxCache);
    if (!buffer) {
      return;
    }
    startDogsBufferedSfx(context, buffer, gain);
  } catch {
    pushTrace(`EutherDogs SFX skipped: ${sound}`);
  }
}

function playDogsCachedSfxNow(sound: string, gain = 0.55): boolean {
  const url = dogsSfxAsset(sound);
  const buffer = url ? dogsSfxCache.get(url) : null;
  if (!audioContext || !buffer) return false;
  void audioContext.resume().catch(() => undefined);
  startDogsBufferedSfx(audioContext, buffer, gain);
  return true;
}

async function loadDogsSfx(sound: string): Promise<void> {
  const url = dogsSfxAsset(sound);
  if (!url || dogsSfxCache.has(url)) return;
  await loadDogsAudioBuffer(url, dogsSfxCache);
}

function startDogsBufferedSfx(context: AudioContext, buffer: AudioBuffer, gain: number): void {
  const source = context.createBufferSource();
  const sfxGain = context.createGain();
  sfxGain.gain.value = Math.max(0, Math.min(1, gain));
  source.buffer = buffer;
  source.connect(sfxGain);
  sfxGain.connect(audioGain ?? context.destination);
  activeAudioSources.add(source);
  source.onended = () => {
    activeAudioSources.delete(source);
    sfxGain.disconnect();
  };
  source.start();
}

async function playDogsMusic(track: string, gain = 0.34): Promise<void> {
  const url = dogsMusicAsset(track);
  if (!url || dogsMusicKey === track) return;
  try {
    const context = await ensureAudio();
    if (!context) return;
    const buffer = await loadDogsAudioBuffer(url, dogsMusicCache);
    if (!buffer) {
      return;
    }
    stopDogsMusic(false);
    const source = context.createBufferSource();
    const trackGain = context.createGain();
    source.buffer = buffer;
    source.loop = true;
    trackGain.gain.value = Math.max(0, Math.min(1, gain));
    source.connect(trackGain);
    trackGain.connect(audioGain ?? context.destination);
    dogsMusicKey = track;
    dogsMusicSource = source;
    dogsMusicGain = trackGain;
    activeAudioSources.add(source);
    source.onended = () => {
      activeAudioSources.delete(source);
      if (dogsMusicSource === source) {
        dogsMusicSource = null;
        dogsMusicGain = null;
        dogsMusicKey = null;
      }
      try {
        trackGain.disconnect();
      } catch {
        // The track may already have been disconnected during an explicit music change.
      }
    };
    source.start();
  } catch {
    pushTrace(`EutherDogs music skipped: ${track}`);
  }
}

function playDogsMissionMusic(mission: number | null | undefined): void {
  void playDogsMusic(dogsMissionMusicKey(mission), 0.34);
}

function stopDogsMusic(clearKey = true): void {
  const source = dogsMusicSource;
  const gain = dogsMusicGain;
  dogsMusicSource = null;
  dogsMusicGain = null;
  if (clearKey) {
    dogsMusicKey = null;
  }
  if (source) {
    activeAudioSources.delete(source);
    try {
      source.stop();
    } catch {
      // Already stopped by the audio engine.
    }
    try {
      source.disconnect();
    } catch {
      // Already disconnected.
    }
  }
  try {
    gain?.disconnect();
  } catch {
    // Already disconnected.
  }
}

function applyEutherDogsCssAssets(): void {
  const plannedAssets: Record<string, string> = {
    "--dogs-shift-console": "shift_console_background",
    "--dogs-staff-roster": "staff_roster_background",
    "--dogs-dispensary": "dispensary_background",
    "--dogs-briefing": "shift_briefing_background",
    "--dogs-logo": "eutherdogs_logo",
    "--dogs-lamp-off": "selector_lamp_off",
    "--dogs-lamp-on": "selector_lamp_on",
    "--dogs-hud-bar": "hud_health_bar",
    "--dogs-menu-panel": "menu_panel",
    "--dogs-map-overlay": "security_map_overlay",
  };
  for (const [property, key] of Object.entries(plannedAssets)) {
    const url = dogsAsset("ui.planned", key);
    if (url) {
      document.documentElement.style.setProperty(property, `url("${url}")`);
    }
  }
}

function formatDogsClock(ticks: number | null | undefined): string {
  if (!Number.isFinite(ticks ?? NaN)) return "--";
  const totalSeconds = Math.max(0, Math.ceil((ticks ?? 0) / 60));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function dogsClockSource(summary: DogsCoreSummary): { label: string; ticks: number | null | undefined } {
  return summary.timeRemainingTicks == null
    ? { label: "Elapsed", ticks: summary.elapsedTicks }
    : { label: "Deadline", ticks: summary.timeRemainingTicks };
}

function updateDogsConsole(frame: DogsCoreFrame): void {
  const hero = dogsLocalPlayer(frame);
  const status = frame.summary.status.toUpperCase();
  const weapon = hero?.activeWeapon.replaceAll("_", " ") ?? "scanner";
  const armor = Math.max(0, hero?.armor ?? 0);
  const healthPercent = Math.min(100, Math.max(8, armor));
  const clock = dogsClockSource(frame.summary);
  const weaponIcon = dogsWeaponAsset(hero?.activeWeapon);
  const queueLeft = dogsQueueLeft(frame);
  eutherDogsRxLeft.textContent = `${frame.summary.mission}/${frame.summary.maxMission}`;
  eutherDogsTargetsLeft.textContent = String(queueLeft);
  eutherDogsCash.textContent = `$${frame.summary.cash}`;
  eutherDogsClockLabel.textContent = clock.label;
  eutherDogsClock.textContent = formatDogsClock(clock.ticks);
  eutherDogsWeapon.textContent = weapon;
  eutherDogsWeapon.style.setProperty("--dogs-active-weapon", weaponIcon ? `url("${weaponIcon}")` : "none");
  eutherDogsAlert.textContent =
    frame.summary.bossActive
      ? `BOSS:${frame.summary.bossName ?? "NGR3"}`
      : status === "RUNNING" ? `Mission ${frame.summary.mission}/${frame.summary.maxMission}` : `Mission ${status}`;
  eutherDogsHealthFill.style.width = `${healthPercent}%`;
  eutherDogsLamp.classList.toggle("is-hot", queueLeft > 0 && frame.summary.status === "running");
  eutherDogsConsole.classList.toggle("is-alert", queueLeft > 0);
  eutherDogsConsole.classList.toggle("is-boss", Boolean(frame.summary.bossActive));
  eutherDogsConsole.classList.toggle("is-closed", frame.summary.status !== "running");
  if (dogsMenuMode) {
    renderDogsMenu();
  }
}

function dogsLocalPlayer(frame: DogsCoreFrame): DogsCoreActor | undefined {
  const players = frame.characters.filter((actor) => actor.faction === "player" && actor.alive);
  return (
    players.find((actor) => actor.id === playerPort - 1) ??
    players[playerPort - 1] ??
    players[0]
  );
}

function predictedDogsActor(actor: DogsCoreActor | undefined): DogsCoreActor | undefined {
  if (!actor || actor.faction !== "player" || dogsInputSeq <= dogsLastAckedInputSeq) {
    return actor;
  }
  const dx = Number(inputState.right) - Number(inputState.left);
  const dy = Number(inputState.down) - Number(inputState.up);
  if (dx === 0 && dy === 0) {
    return actor;
  }
  const unacked = Math.min(2, Math.max(1, dogsInputSeq - dogsLastAckedInputSeq));
  const distance = 1.4 * unacked;
  const diagonal = dx !== 0 && dy !== 0 ? Math.SQRT1_2 : 1;
  return {
    ...actor,
    x: actor.x + Math.round(dx * distance * diagonal),
    y: actor.y + Math.round(dy * distance * diagonal),
  };
}

function smoothDogsActor(actor: DogsCoreActor, isLocalPlayer: boolean): DogsCoreActor {
  const key = `${actor.faction}:${actor.id}`;
  const previous = dogsRenderActorPositions.get(key);
  if (!previous) {
    dogsRenderActorPositions.set(key, { x: actor.x, y: actor.y });
    return actor;
  }
  const dx = actor.x - previous.x;
  const dy = actor.y - previous.y;
  if (Math.hypot(dx, dy) > 80) {
    dogsRenderActorPositions.set(key, { x: actor.x, y: actor.y });
    return actor;
  }
  const elapsedFrames = Math.min(3, Math.max(0.5, (performance.now() - dogsLastRenderAt) / (1000 / 60)));
  const distance = Math.hypot(dx, dy);
  const maxStep = (isLocalPlayer ? 3.4 : 3.0) * elapsedFrames;
  const step = distance <= maxStep || distance === 0 ? 1 : maxStep / distance;
  const x = previous.x + dx * step;
  const y = previous.y + dy * step;
  const smoothed = { x, y };
  dogsRenderActorPositions.set(key, smoothed);
  return { ...actor, x, y };
}

function dogsCurrentCash(): number {
  return dogsFrame?.summary.cash ?? 0;
}

function dogsCurrentHero(): DogsCoreActor | null {
  return dogsFrame ? dogsLocalPlayer(dogsFrame) ?? null : null;
}

function dogsAmmoLabel(ammo: number | null | undefined): string {
  if (ammo == null) return "Not stocked";
  return ammo < 0 ? "INF" : String(ammo);
}

const dogsStoreCatalog: Array<Pick<DogsStoreItem, "id" | "label" | "price" | "detail" | "weapon" | "ammo" | "armor">> = [
  {
    id: "label_printer",
    label: "Label Printer",
    price: 125,
    detail: "Fast short-range sticker burst",
    weapon: "label_printer",
    ammo: 80,
    armor: 0,
  },
  {
    id: "sterilizer_spray",
    label: "Sterilizer Spray",
    price: 175,
    detail: "Wide cone for queue control",
    weapon: "sterilizer_spray",
    ammo: 70,
    armor: 0,
  },
  {
    id: "capsule_launcher",
    label: "Capsule Launcher",
    price: 250,
    detail: "Slow explosive capsule dose",
    weapon: "capsule_launcher",
    ammo: 12,
    armor: 0,
  },
  {
    id: "autoinjector",
    label: "Autoinjector",
    price: 210,
    detail: "Single-dose dart with rude bedside manner",
    weapon: "autoinjector",
    ammo: 24,
    armor: 0,
  },
  {
    id: "needlegun",
    label: "Needlegun",
    price: 275,
    detail: "Rapid insurance-approved acupuncture",
    weapon: "needlegun",
    ammo: 120,
    armor: 0,
  },
  {
    id: "handsanitizer_flamethrower",
    label: "Handsanitizer Flamethrower",
    price: 325,
    detail: "Kills 99.9% of queue escalation",
    weapon: "handsanitizer_flamethrower",
    ammo: 90,
    armor: 0,
  },
  {
    id: "coat_reinforcement",
    label: "Coat Reinforcement",
    price: 100,
    detail: "Add 25 white-coat armor",
    weapon: null,
    ammo: 0,
    armor: 25,
  },
];

function dogsVisibleStoreItems(frame: DogsCoreFrame | null, cash: number, hero: DogsCoreActor | null): DogsStoreItem[] {
  const byId = new Map((frame?.store ?? []).map((item) => [item.id, item]));
  for (const item of dogsStoreCatalog) {
    const existing = byId.get(item.id);
    const active = Boolean(item.weapon && hero?.activeWeapon === item.weapon);
    byId.set(item.id, {
      ...existing,
      ...item,
      owned: item.armor > 0 ? Boolean(existing?.owned) : active || Boolean(existing?.owned),
      currentAmmo: active ? hero?.ammo : existing?.currentAmmo ?? null,
      active,
      affordable: cash >= (existing?.price ?? item.price),
    });
  }
  return dogsStoreCatalog.map((item) => byId.get(item.id)).filter((item): item is DogsStoreItem => Boolean(item));
}

function dogsStoreItemMeta(item: DogsStoreItem): string {
  if (item.armor > 0) {
    return `Coat +${item.armor}`;
  }
  if (item.owned) {
    return `${item.active ? "Active" : "Owned"} | Ammo ${dogsAmmoLabel(item.currentAmmo)}`;
  }
  return `New | Ammo +${dogsAmmoLabel(item.ammo)}`;
}

function dogsStoreActionLabel(item: DogsStoreItem): string {
  if (item.armor > 0) return `Boost $${item.price}`;
  if (item.owned) return `Refill $${item.price}`;
  return `Buy $${item.price}`;
}

function dogsStoreItemStatus(item: DogsStoreItem): string {
  if (item.active) return "Active";
  if (item.owned) return "Owned";
  if (item.armor > 0) return "Coat";
  return "New";
}

function dogsStoreItemClass(item: DogsStoreItem): string {
  return [
    item.active ? "is-equipped" : "",
    item.owned ? "is-owned" : "",
    item.armor > 0 ? "is-armor" : "is-weapon",
    dogsStorePreviewItemId === item.id ? "is-previewed" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function dogsStorePreviewMarkup(item: DogsStoreItem | null): string {
  if (!item) {
    return "";
  }
  const icon = dogsStoreItemIconMarkup(item);
  return `
    <section class="eutherdogs-store-preview" aria-label="RX store preview">
      ${icon}
      <span>${dogsStoreItemStatus(item)}</span>
      <strong>${item.label}</strong>
      <small>${item.detail}</small>
      <small>${dogsStoreItemMeta(item)}</small>
      <em>${dogsStoreActionLabel(item)}</em>
    </section>
  `;
}

function dogsInventoryMarkup(hero: DogsCoreActor | null, storeItems: DogsStoreItem[], cash: number): string {
  const ownedWeapons = storeItems.filter((item) => item.weapon && item.owned);
  const protocolOwned = (dogsFrame?.summary.inspectionProtocol ?? 0) > 0;
  const heroAsset = hero ? dogsActorAsset(hero) : null;
  const activeWeapon = hero?.activeWeapon ?? "scanner_blaster";
  const activeWeaponItem = storeItems.find((item) => item.weapon === activeWeapon);
  const armorOn = (hero?.armor ?? 0) > 100;
  const artifactSlots = [
    ...(protocolOwned
      ? [
          dogsInventoryArtifactSlot(
            "Inspection Protocol",
            "Level 2 audit artifact",
            dogsAsset("items", "routine_directive") ?? dogsAsset("items", "folder"),
          ),
        ]
      : []),
    ...Array.from({ length: protocolOwned ? 17 : 18 }, () => dogsInventoryEmptySlot()),
  ].join("");
  const weaponSlots = [
    ...ownedWeapons.map((item) => dogsInventoryWeaponSlot(item, item.weapon === activeWeapon)),
    ...Array.from({ length: Math.max(0, 12 - ownedWeapons.length) }, () => dogsInventoryEmptySlot()),
  ].join("");
  return `
    <div class="eutherdogs-inventory-layout">
      <section class="eutherdogs-paperdoll" aria-label="character equipment">
        <div class="eutherdogs-equipment-slot is-weapon">
          <span>Weapon</span>
          ${dogsWeaponIconMarkup(activeWeapon, activeWeapon)}
          <strong>${activeWeaponItem?.label ?? activeWeapon.replaceAll("_", " ")}</strong>
          <small>Ammo ${dogsAmmoLabel(hero?.ammo)}</small>
        </div>
        <div class="eutherdogs-hero-stand">
          ${heroAsset ? `<img src="${heroAsset}" alt="${dogsCharacterName(selectedDogsCharacters[playerPort])}" />` : ""}
          <strong>${dogsCharacterName(selectedDogsCharacters[playerPort])}</strong>
          <span>${armorOn ? "Armored coat engaged" : "Standard coat"}</span>
        </div>
        <div class="eutherdogs-equipment-slot is-armor">
          <span>Coat</span>
          ${dogsInventoryItemIcon(dogsAsset("items", "lab_coat_armor"), "coat")}
          <strong>${armorOn ? "Armored coat" : "White coat"}</strong>
          <small>Integrity ${hero?.armor ?? 0}</small>
        </div>
      </section>
      <section class="eutherdogs-inventory-ledger" aria-label="inventory slots">
        <div class="eutherdogs-inventory-stats">
          <div><span>Cash</span><strong>$${cash}</strong></div>
          <div><span>RX</span><strong>${dogsFrame?.summary.objectsCollected ?? 0}</strong></div>
          <div><span>Score</span><strong>${dogsFrame?.summary.score ?? 0}</strong></div>
        </div>
        <p class="section-label">Weapons</p>
        <div class="eutherdogs-inventory-grid is-weapons">${weaponSlots}</div>
        <p class="section-label">Artifacts</p>
        <div class="eutherdogs-inventory-grid is-artifacts">${artifactSlots}</div>
      </section>
    </div>
  `;
}

function dogsInventoryWeaponSlot(item: DogsStoreItem, active: boolean): string {
  return `
    <div class="eutherdogs-inventory-slot ${active ? "is-active" : ""}">
      ${dogsStoreItemIconMarkup(item)}
      <strong>${item.label}</strong>
      <small>${active ? "Equipped" : "Stored"} | Ammo ${dogsAmmoLabel(item.currentAmmo)}</small>
    </div>
  `;
}

function dogsInventoryArtifactSlot(label: string, detail: string, icon: string | null): string {
  return `
    <div class="eutherdogs-inventory-slot is-artifact">
      ${dogsInventoryItemIcon(icon, label)}
      <strong>${label}</strong>
      <small>${detail}</small>
    </div>
  `;
}

function dogsInventoryEmptySlot(): string {
  return `<div class="eutherdogs-inventory-slot is-empty" aria-hidden="true"></div>`;
}

function dogsInventoryItemIcon(url: string | null, label: string): string {
  return url
    ? `<img class="eutherdogs-weapon-icon" src="${url}" alt="${label}" />`
    : `<span class="eutherdogs-weapon-icon is-empty" aria-hidden="true"></span>`;
}

function dogsDefaultHighScores(): DogsHighScoreEntry[] {
  return [
    {
      id: "seed-anon",
      name: "ANON",
      score: 1000,
      cash: 100,
      mission: 1,
      kills: 10,
      targetsDestroyed: 3,
      objectsCollected: 5,
      elapsedTicks: 3600,
      completed: true,
      staff: "Counter",
      createdAt: "2026-05-27T00:00:00.000Z",
    },
  ];
}

function parseDogsHighScoresToml(toml: string): DogsHighScoreEntry[] {
  const entries: DogsHighScoreEntry[] = [];
  let current: Record<string, string> | null = null;
  const flush = () => {
    if (!current) return;
    const entry = normalizeDogsHighScoreEntry({
      id: current.id,
      name: current.name,
      score: Number(current.score),
      cash: Number(current.cash),
      mission: Number(current.mission),
      kills: Number(current.kills),
      targetsDestroyed: Number(current.targets_destroyed),
      objectsCollected: Number(current.objects_collected),
      elapsedTicks: Number(current.elapsed_ticks),
      completed: current.completed === "true",
      staff: current.staff,
      createdAt: current.created_at,
    });
    if (entry) entries.push(entry);
  };
  for (const rawLine of toml.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line === "[[highscores]]") {
      flush();
      current = {};
      continue;
    }
    if (!current) continue;
    const match = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    const value = rawValue.trim();
    current[key] = value.startsWith('"') ? value.replace(/^"|"$/g, "").replace(/\\"/g, '"').replace(/\\\\/g, "\\") : value;
  }
  flush();
  return entries.sort(compareDogsHighScores).slice(0, dogsHighScoreLimit);
}

function tomlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function serializeDogsHighScoresToml(entries: DogsHighScoreEntry[]): string {
  const lines = [
    "# EutherDogs high scores",
    "# Edit values freely if you want to mod or cheat the board.",
    "",
  ];
  for (const entry of entries.sort(compareDogsHighScores).slice(0, dogsHighScoreLimit)) {
    lines.push("[[highscores]]");
    lines.push(`id = ${tomlString(entry.id)}`);
    lines.push(`name = ${tomlString(entry.name)}`);
    lines.push(`score = ${Math.trunc(entry.score)}`);
    lines.push(`cash = ${Math.trunc(entry.cash)}`);
    lines.push(`mission = ${Math.trunc(entry.mission)}`);
    lines.push(`kills = ${Math.trunc(entry.kills)}`);
    lines.push(`targets_destroyed = ${Math.trunc(entry.targetsDestroyed)}`);
    lines.push(`objects_collected = ${Math.trunc(entry.objectsCollected)}`);
    lines.push(`elapsed_ticks = ${Math.trunc(entry.elapsedTicks)}`);
    lines.push(`completed = ${entry.completed ? "true" : "false"}`);
    lines.push(`staff = ${tomlString(entry.staff)}`);
    lines.push(`created_at = ${tomlString(entry.createdAt)}`);
    lines.push("");
  }
  return lines.join("\n");
}

async function loadDogsHighScoresToml(): Promise<void> {
  if (dogsHighScoresTomlLoadAttempted) return;
  if (!isTauri && ui.runtime !== "bridge") return;
  dogsHighScoresTomlLoadAttempted = true;
  const toml = await readDogsHighScoresToml();
  if (!toml) {
    await saveDogsHighScoresToml(serializeDogsHighScoresToml(readDogsHighScores()));
    return;
  }
  const entries = parseDogsHighScoresToml(toml);
  if (entries.length > 0) {
    window.localStorage.setItem(dogsHighScoresStorageKey, JSON.stringify(entries));
  }
}

async function readDogsHighScoresToml(): Promise<string | null> {
  if (isTauri) {
    try {
      return await invoke<string | null>("read_eutherdogs_highscores_toml");
    } catch {
      return null;
    }
  }
  if (ui.runtime === "bridge") {
    try {
      const response = await bridgeRequest("/eutherdogs-highscores", {}, 300);
      if (response.status === 204) return null;
      return await response.text();
    } catch {
      return null;
    }
  }
  return null;
}

async function saveDogsHighScoresToml(toml: string): Promise<void> {
  if (isTauri) {
    try {
      await invoke("save_eutherdogs_highscores_toml", { toml });
    } catch {
      pushTrace("EutherDogs highscore TOML save missed");
    }
    return;
  }
  if (ui.runtime === "bridge") {
    try {
      await bridgeRequest("/eutherdogs-highscores", {
        method: "POST",
        headers: { "Content-Type": "text/plain; charset=utf-8" },
        body: toml,
      });
    } catch {
      pushTrace("EutherDogs highscore TOML save missed");
    }
  }
}

function normalizeDogsHighScoreEntry(value: unknown): DogsHighScoreEntry | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Partial<DogsHighScoreEntry>;
  const score = Number(entry.score);
  if (!Number.isFinite(score)) return null;
  const name = String(entry.name ?? "ANON").trim().slice(0, 16) || "ANON";
  return {
    id: String(entry.id ?? `score-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`),
    name,
    score,
    cash: Number(entry.cash) || 0,
    mission: Number(entry.mission) || 1,
    kills: Number(entry.kills) || 0,
    targetsDestroyed: Number(entry.targetsDestroyed) || 0,
    objectsCollected: Number(entry.objectsCollected) || 0,
    elapsedTicks: Number(entry.elapsedTicks) || 0,
    completed: Boolean(entry.completed),
    staff: String(entry.staff ?? "Counter").slice(0, 24),
    createdAt: String(entry.createdAt ?? new Date().toISOString()),
  };
}

function compareDogsHighScores(a: DogsHighScoreEntry, b: DogsHighScoreEntry): number {
  return (
    Number(b.completed) - Number(a.completed) ||
    b.score - a.score ||
    b.mission - a.mission ||
    b.kills - a.kills ||
    b.targetsDestroyed - a.targetsDestroyed ||
    b.objectsCollected - a.objectsCollected ||
    a.elapsedTicks - b.elapsedTicks ||
    a.name.localeCompare(b.name)
  );
}

function readDogsHighScores(): DogsHighScoreEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(dogsHighScoresStorageKey) ?? "[]");
    const entries = Array.isArray(parsed)
      ? parsed.map(normalizeDogsHighScoreEntry).filter((entry): entry is DogsHighScoreEntry => Boolean(entry))
      : [];
    return (entries.length ? entries : dogsDefaultHighScores()).sort(compareDogsHighScores).slice(0, dogsHighScoreLimit);
  } catch {
    return dogsDefaultHighScores();
  }
}

function writeDogsHighScores(entries: DogsHighScoreEntry[]): void {
  localStorage.setItem(
    dogsHighScoresStorageKey,
    JSON.stringify(entries.sort(compareDogsHighScores).slice(0, dogsHighScoreLimit)),
  );
}

function makeDogsHighScoreEntry(frame: DogsCoreFrame, name: string): DogsHighScoreEntry {
  const staff = dogsStaffOptions.find((option) => option.id === selectedDogsStaff);
  return {
    id: `score-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    name: name.trim().slice(0, 3).toUpperCase() || "AAA",
    score: frame.summary.score,
    cash: frame.summary.cash,
    mission: frame.summary.mission || selectedDogsMission,
    kills: frame.summary.kills,
    targetsDestroyed: frame.summary.targetsDestroyed,
    objectsCollected: frame.summary.objectsCollected,
    elapsedTicks: frame.summary.elapsedTicks,
    completed: frame.summary.status === "won",
    staff: staff?.role ?? "Counter",
    createdAt: new Date().toISOString(),
  };
}

function storeDogsHighScoreEntry(entry: DogsHighScoreEntry): void {
  const entries = [...readDogsHighScores(), entry].sort(compareDogsHighScores).slice(0, dogsHighScoreLimit);
  writeDogsHighScores(entries);
  void saveDogsHighScoresToml(serializeDogsHighScoresToml(entries));
}

function queueDogsHighScore(frame: DogsCoreFrame): void {
  if (frame.summary.status === "running" || dogsSubmittedHighscoreFrame === frame.frame) return;
  dogsSubmittedHighscoreFrame = frame.frame;
  dogsPendingHighscoreFrame = frame;
  dogsHighscoreInitials = ["A", "A", "A"];
  dogsHighscoreInitialIndex = 0;
  dogsHighscoreSavedName = null;
}

function stepDogsHighscoreInitial(delta: number): void {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const current = alphabet.indexOf(dogsHighscoreInitials[dogsHighscoreInitialIndex] ?? "A");
  dogsHighscoreInitials[dogsHighscoreInitialIndex] = alphabet[(current + delta + alphabet.length) % alphabet.length];
}

async function submitPendingDogsHighScore(): Promise<void> {
  if (!dogsPendingHighscoreFrame) return;
  const name = dogsHighscoreInitials.join("");
  storeDogsHighScoreEntry(makeDogsHighScoreEntry(dogsPendingHighscoreFrame, name));
  dogsPendingHighscoreFrame = null;
  dogsHighscoreSavedName = name;
  renderDogsMenu();
}

function dogsTimeLabel(ticks: number): string {
  const totalSeconds = Math.max(0, Math.floor(ticks / 60));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function dogsHighScoreBoardMarkup(): string {
  const entries = readDogsHighScores();
  dogsSelectedHighScoreIndex = Math.max(0, Math.min(dogsSelectedHighScoreIndex, entries.length - 1));
  const selected = entries[dogsSelectedHighScoreIndex] ?? null;
  const backMarkup = `
    <button class="eutherdogs-score-back" data-score-back="true" type="button">
      Back
    </button>
  `;
  if (!entries.length) {
    return `
      <div class="eutherdogs-scoreboard">
        ${backMarkup}
        <div class="eutherdogs-score-empty">No closures logged</div>
      </div>
    `;
  }
  return `
    <div class="eutherdogs-scoreboard">
      ${backMarkup}
      ${
        selected
          ? `
            <div class="eutherdogs-score-detail">
              <span>${String(dogsSelectedHighScoreIndex + 1).padStart(2, "0")}</span>
              <strong>${escapeHtml(selected.name)}</strong>
              <em>${selected.score}</em>
              <small>${selected.completed ? "Closed" : "Failed"} | K ${selected.kills} | RX ${selected.objectsCollected} | ${dogsTimeLabel(selected.elapsedTicks)}</small>
            </div>
          `
          : ""
      }
      ${entries
        .map(
          (entry, index) => `
            <button class="eutherdogs-score-row ${index === dogsSelectedHighScoreIndex ? "is-selected" : ""} ${entry.completed ? "is-complete" : "is-failed"}" data-score-row="${index}" type="button">
              <span>${String(index + 1).padStart(2, "0")}</span>
              <strong>${escapeHtml(entry.name)}</strong>
              <em>${entry.score}</em>
              <small>${entry.completed ? "Closed" : "Failed"} | K ${entry.kills} | RX ${entry.objectsCollected} | ${dogsTimeLabel(entry.elapsedTicks)}</small>
            </button>
          `,
        )
        .join("")}
    </div>
  `;
}

function dogsHighScoreEntryMarkup(frame: DogsCoreFrame | null): string {
  if (!frame) return dogsHighScoreBoardMarkup();
  return `
    <div class="eutherdogs-score-entry">
      <div class="eutherdogs-score-entry-summary">
        <span>Score</span><strong>${frame.summary.score}</strong>
        <span>Cash</span><strong>$${frame.summary.cash}</strong>
        <span>Queue</span><strong>${frame.summary.kills}</strong>
      </div>
      <div class="eutherdogs-initials" aria-label="high score initials">
        ${dogsHighscoreInitials
          .map(
            (letter, index) => `
              <button class="${index === dogsHighscoreInitialIndex ? "is-active" : ""}" data-score-initial="${index}" type="button">
                ${letter}
              </button>
            `,
          )
          .join("")}
      </div>
      <div class="eutherdogs-initial-actions">
        <button data-score-step="-1" type="button">Prev</button>
        <button data-score-step="1" type="button">Next</button>
        <button data-score-submit="true" type="button">Save</button>
      </div>
    </div>
  `;
}

function dogsHighScoreSavedMarkup(): string {
  if (!dogsHighscoreSavedName) return "";
  return `
    <div class="eutherdogs-score-entry">
      <div class="eutherdogs-score-entry-summary">
        <span>Highscore</span><strong>Saved</strong>
        <span>Name</span><strong>${dogsHighscoreSavedName}</strong>
      </div>
    </div>
  `;
}

function showDogsMenu(mode: Exclude<DogsMenuMode, null>): void {
  hideDogsInventory();
  dogsMenuMode = mode;
  ui.playing = false;
  playToggle.textContent = "Play";
  stopDogsSnapshotStream();
  stopBridgeStream();
  renderDogsMenu();
  eutherDogsMenu.setAttribute("aria-hidden", "false");
  eutherDogsMenu.classList.add("is-open");
}

function toggleDogsInventory(): void {
  if (!dogsFrame) return;
  if (dogsInventoryOpen) {
    hideDogsInventory();
    return;
  }
  if (dogsMenuMode) {
    hideDogsMenu();
  }
  showDogsInventory();
}

function showDogsInventory(): void {
  if (!dogsFrame) return;
  dogsInventoryOpen = true;
  renderDogsInventoryPopup();
  eutherDogsInventoryPopup.setAttribute("aria-hidden", "false");
  eutherDogsInventoryPopup.classList.add("is-open");
}

function hideDogsInventory(): void {
  dogsInventoryOpen = false;
  eutherDogsInventoryPopup.setAttribute("aria-hidden", "true");
  eutherDogsInventoryPopup.classList.remove("is-open");
}

function renderDogsInventoryPopup(): void {
  const cash = dogsCurrentCash();
  const hero = dogsCurrentHero();
  const storeItems = dogsVisibleStoreItems(dogsFrame, cash, hero);
  eutherDogsInventoryTitle.textContent = `${dogsCharacterName(selectedDogsCharacters[playerPort])} Field Kit`;
  eutherDogsInventoryBody.innerHTML = dogsInventoryMarkup(hero, storeItems, cash);
}

function dogsPreloadPercent(): number {
  if (!dogsPreloadProgress) return 0;
  const total = Math.max(1, dogsPreloadProgress.total);
  return Math.min(100, Math.round((dogsPreloadProgress.loaded / total) * 100));
}

function renderDogsPreloadOverlay(): void {
  if (!dogsPreloadProgress) {
    eutherDogsLoadingOverlay.hidden = true;
    return;
  }
  const percent = dogsPreloadPercent();
  eutherDogsLoadingOverlay.hidden = false;
  eutherDogsLoadingPercent.textContent = `${percent}%`;
  eutherDogsLoadingMeter.setAttribute("aria-valuenow", String(percent));
  eutherDogsLoadingFill.style.width = `${percent}%`;
  eutherDogsLoadingLabel.textContent = dogsPreloadProgress.label;
  eutherDogsLoadingDetail.textContent = `${dogsPreloadProgress.loaded} / ${dogsPreloadProgress.total} assets prepared`;
}

function hideDogsMenu(): void {
  dogsMenuMode = null;
  eutherDogsMenu.setAttribute("aria-hidden", "true");
  eutherDogsMenu.classList.remove("is-open");
}

async function startDogsShift(): Promise<void> {
  await preloadDogsVisualAssets();
  await ensureAudio();
  hideDogsMenu();
  hideDogsInventory();
  if (controlsOpen) {
    closeControls();
  }
  ui.playing = true;
  ui.status = "DOGS RUNNING";
  playToggle.textContent = "Pause";
  startDogsSnapshotStream();
  nextFrameDue = performance.now();
  renderUi();
  void animationLoop();
}

function renderDogsMenu(): void {
  const cash = dogsCurrentCash();
  const hero = dogsCurrentHero();
  const storeItems = dogsVisibleStoreItems(dogsFrame, cash, hero);
  const mission = dogsFrame?.summary.mission ?? selectedDogsMission;
  const maxMission = dogsFrame?.summary.maxMission ?? 10;
  eutherDogsMenuCash.textContent = `$${cash}`;
  if (dogsPreloadProgress) {
    const percent = dogsPreloadPercent();
    eutherDogsMenuKicker.textContent = "RX Asset Warmup";
    eutherDogsMenuTitle.textContent = "Preparing the counter";
    eutherDogsStartShift.textContent = `${percent}%`;
    eutherDogsStartShift.disabled = true;
    eutherDogsMenuBody.innerHTML = `
      <div class="eutherdogs-loading-panel">
        <div class="eutherdogs-loading-meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}">
          <span style="width: ${percent}%"></span>
        </div>
        <strong>${percent}%</strong>
        <p>${escapeHtml(dogsPreloadProgress.label)}</p>
        <small>${dogsPreloadProgress.loaded} / ${dogsPreloadProgress.total} assets prepared</small>
      </div>
    `;
    return;
  }
  eutherDogsStartShift.disabled = false;
  eutherDogsStaffOpen.classList.toggle("is-active", dogsMenuMode === "staff");
  eutherDogsStoreOpen.classList.toggle("is-active", dogsMenuMode === "store");
  eutherDogsBriefingOpen.classList.toggle("is-active", dogsMenuMode === "briefing");
  eutherDogsScoresOpen.classList.toggle("is-active", dogsMenuMode === "scores");
  eutherDogsStartShift.textContent =
    dogsMenuMode === "scores"
      ? "Back"
      : dogsMenuMode === "result" && dogsFrame?.summary.status === "won"
      ? mission >= maxMission
        ? "Main menu"
        : "Next shift"
      : dogsMenuMode === "result"
        ? "Retry shift"
        : "Start shift";
  eutherDogsMenu.classList.toggle("is-staff", dogsMenuMode === "staff");
  eutherDogsMenu.classList.toggle("is-store", dogsMenuMode === "store");
  eutherDogsMenu.classList.toggle("is-briefing", dogsMenuMode === "briefing");
  eutherDogsMenu.classList.toggle("is-scores", dogsMenuMode === "scores");
  eutherDogsMenu.classList.toggle("is-result", dogsMenuMode === "result");
  if (dogsMenuMode === "staff") {
    eutherDogsMenuKicker.textContent = "Staff Select";
    eutherDogsMenuTitle.textContent = `Choose P${playerPort} Counter Liability`;
    eutherDogsMenuBody.innerHTML = `
      <div class="eutherdogs-briefing-grid">
        <div><span>P1</span><strong>${dogsCharacterName(selectedDogsCharacters[1])}</strong></div>
        <div><span>P2</span><strong>${dogsCharacterName(selectedDogsCharacters[2])}</strong></div>
      </div>
      <div class="eutherdogs-staff-grid">
        ${dogsStaffOptions
          .map(
            (staff) => `
              <button class="eutherdogs-staff-card ${selectedDogsCharacters[playerPort] === staff.character ? "is-selected" : ""}" data-staff-id="${staff.id}" type="button">
                <span class="eutherdogs-selector-lamp"></span>
                ${dogsStaffSpriteMarkup(staff)}
                <span>${staff.role}</span>
                <strong>${staff.name}</strong>
                <small>Coat ${staff.armor} | Cash $${staff.cash}</small>
                <small>${staff.loadout}</small>
                <em>${staff.note}</em>
              </button>
            `,
          )
          .join("")}
      </div>
    `;
    return;
  }
  if (dogsMenuMode === "briefing") {
    const summary = dogsFrame?.summary;
    const queueLeft = dogsQueueLeft(dogsFrame);
    eutherDogsMenuKicker.textContent = "Briefing";
    eutherDogsMenuTitle.textContent = `Mission ${mission}/${maxMission} Protocol`;
    eutherDogsMenuBody.innerHTML = `
      <div class="eutherdogs-briefing-grid">
        <div><span>Mission</span><strong>${mission} / ${maxMission}</strong></div>
        <div><span>Retrieve</span><strong>${summary?.objectsLeft ?? 0} RX objects</strong></div>
        <div><span>Defuse</span><strong>${queueLeft} angry customers</strong></div>
        <div><span>Minimum</span><strong>${summary?.minimumKills ?? 0} removals</strong></div>
        <div><span>Policy</span><strong>No refunds after laser contact</strong></div>
        <div><span>Uniform</span><strong>White coat, zero patience</strong></div>
      </div>
      <div class="eutherdogs-level-select" aria-label="mission select">
        ${Array.from({ length: maxMission }, (_, index) => index + 1)
          .map(
            (level) => `
              <button class="${level === selectedDogsMission ? "is-selected" : ""}" data-dogs-mission="${level}" type="button">
                <span>Level</span>
                <strong>${level}</strong>
              </button>
            `,
          )
          .join("")}
      </div>
    `;
    return;
  }
  if (dogsMenuMode === "scores") {
    eutherDogsMenuKicker.textContent = "High Score Board";
    eutherDogsMenuTitle.textContent = "Best Counter Closures";
    eutherDogsMenuBody.innerHTML = dogsHighScoreBoardMarkup();
    return;
  }
  if (dogsMenuMode === "result") {
    const summary = dogsFrame?.summary;
    const won = summary?.status === "won";
    eutherDogsMenuKicker.textContent = won ? "Shift Closed" : "Shift Failed";
    eutherDogsMenuTitle.textContent = dogsPendingHighscoreFrame
      ? "Enter Initials"
      : won
        ? "Receipts Balanced"
        : "Counter Incident Report";
    eutherDogsMenuBody.innerHTML = `
      <div class="eutherdogs-result-grid">
        <div><span>Mission</span><strong>${summary?.mission ?? mission} / ${summary?.maxMission ?? maxMission}</strong></div>
        <div><span>Status</span><strong>${summary?.status.toUpperCase() ?? "UNKNOWN"}</strong></div>
        <div><span>Score</span><strong>${summary?.score ?? 0}</strong></div>
        <div><span>Cash</span><strong>$${summary?.cash ?? 0}</strong></div>
        <div><span>Kills</span><strong>${summary?.kills ?? 0}</strong></div>
        <div><span>RX collected</span><strong>${summary?.objectsCollected ?? 0}</strong></div>
        <div><span>Targets</span><strong>${summary?.targetsDestroyed ?? 0}</strong></div>
        <div><span>Shots / hits</span><strong>${summary?.shotsFired ?? 0} / ${summary?.hits ?? 0}</strong></div>
        <div><span>Damage taken</span><strong>${summary?.damageTaken ?? 0}</strong></div>
        <div><span>Board</span><strong>${readDogsHighScores()[0]?.score ?? 0}</strong></div>
      </div>
      ${dogsPendingHighscoreFrame ? dogsHighScoreEntryMarkup(dogsPendingHighscoreFrame) : dogsHighScoreSavedMarkup()}
    `;
    return;
  }
  eutherDogsMenuKicker.textContent = "RX Store";
  eutherDogsMenuTitle.textContent = `Counter | Coat ${hero?.armor ?? 0} | ${hero?.activeWeapon.replaceAll("_", " ") ?? "scanner"}`;
  const previewItem =
    storeItems.find((item) => item.id === dogsStorePreviewItemId) ??
    storeItems.find((item) => item.active) ??
    storeItems[0] ??
    null;
  eutherDogsMenuBody.innerHTML = storeItems
    ? `
      <div class="eutherdogs-armory-layout">
        <aside class="eutherdogs-inventory-panel">
          <section class="eutherdogs-player-loadout">
            ${hero ? dogsWeaponIconMarkup(hero.activeWeapon, hero.activeWeapon) : ""}
            <strong>${dogsCharacterName(selectedDogsCharacters[playerPort])}</strong>
            <span>Coat ${hero?.armor ?? 0}</span>
            <span>Active ${hero?.activeWeapon.replaceAll("_", " ") ?? "scanner"}</span>
            <span>Ammo ${dogsAmmoLabel(hero?.ammo)}</span>
            <em>Cash $${cash}</em>
          </section>
          ${dogsStorePreviewMarkup(previewItem)}
        </aside>
        <div class="eutherdogs-store-grid">
          ${storeItems
            .map((item) => {
              return `
                <div class="eutherdogs-store-item ${dogsStoreItemClass(item)}" data-store-item="${item.id}" role="button" tabindex="0">
                  ${dogsStoreItemIconMarkup(item)}
                  <span>
                    <b>${dogsStoreItemStatus(item)}</b>
                    <strong>${item.label}</strong>
                    <small>${item.detail}</small>
                    <small>${dogsStoreItemMeta(item)}</small>
                  </span>
                  <button class="eutherdogs-store-buy" data-store-buy="${item.id}" type="button" ${item.affordable ? "" : "disabled"}>
                    ${dogsStoreActionLabel(item)}
                  </button>
                </div>
              `;
            })
            .join("")}
        </div>
      </div>
    `
    : "";
}

async function purchaseDogsStoreItem(itemId: string): Promise<void> {
  if (!itemId) return;
  try {
    void playDogsSfx("impact_heavy", 0.9);
    void playDogsSfx("pickup_rx", 0.5);
    dogsFrame = await purchaseDogsCoreItem(itemId);
    processDogsAudio(dogsFrame);
    drawDogsFrame(dogsFrame);
    renderDogsMenu();
    pushTrace(`RX Store purchased ${itemId}`);
  } catch (err) {
    pushTrace(`RX Store denied ${itemId}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function selectDogsStaff(staff: 1 | 2): Promise<void> {
  selectedDogsStaff = staff;
  selectedDogsCharacters[playerPort] = dogsStaffOptions.find((option) => option.id === staff)?.character ?? "night_shift_tech";
  writeStoredDogsCharacters();
  try {
    dogsFrame = await startDogsCore();
    selectedDogsMission = dogsFrame.summary.mission || selectedDogsMission;
    dogsLastExitReady = dogsExitReady(dogsFrame);
    dogsLastPortalHumFrame = -9999;
    dogsPreviousAudioFrame = dogsFrame;
    playDogsMissionMusic(dogsFrame.summary.mission);
    drawDogsFrame(dogsFrame);
    showDogsMenu("store");
    pushTrace(`EutherDogs P${playerPort} selected ${dogsCharacterName(selectedDogsCharacters[playerPort])}`);
  } catch (err) {
    pushTrace(`EutherDogs staff select failed: ${err instanceof Error ? err.message : String(err)}`);
    renderDogsMenu();
  }
}

async function selectDogsMission(mission: number): Promise<void> {
  selectedDogsMission = Math.min(10, Math.max(1, Math.trunc(mission)));
  try {
    dogsFrame = await startDogsCore();
    selectedDogsMission = dogsFrame.summary.mission || selectedDogsMission;
    dogsLastExitReady = dogsExitReady(dogsFrame);
    dogsLastPortalHumFrame = -9999;
    dogsPreviousAudioFrame = dogsFrame;
    playDogsMissionMusic(dogsFrame.summary.mission);
    drawDogsFrame(dogsFrame);
    showDogsMenu("briefing");
    pushTrace(`EutherDogs level ${selectedDogsMission} selected`);
  } catch (err) {
    pushTrace(`EutherDogs level select failed: ${err instanceof Error ? err.message : String(err)}`);
    renderDogsMenu();
  }
}

async function retryDogsShift(): Promise<void> {
  try {
    dogsFrame = await startDogsCore();
    selectedDogsMission = dogsFrame.summary.mission || selectedDogsMission;
    dogsLastExitReady = dogsExitReady(dogsFrame);
    dogsLastPortalHumFrame = -9999;
    dogsPreviousAudioFrame = dogsFrame;
    playDogsMissionMusic(dogsFrame.summary.mission);
    drawDogsFrame(dogsFrame);
    showDogsMenu("store");
    pushTrace("EutherDogs shift retried");
  } catch (err) {
    pushTrace(`EutherDogs retry failed: ${err instanceof Error ? err.message : String(err)}`);
    renderDogsMenu();
  }
}

async function startDogsNextMission(): Promise<void> {
  try {
    if (dogsPendingHighscoreFrame) {
      await submitPendingDogsHighScore();
    }
    dogsFrame = await nextDogsCoreMission();
    selectedDogsMission = dogsFrame.summary.mission || selectedDogsMission + 1;
    dogsLastExitReady = dogsExitReady(dogsFrame);
    dogsLastPortalHumFrame = -9999;
    dogsPreviousAudioFrame = dogsFrame;
    playDogsMissionMusic(dogsFrame.summary.mission);
    drawDogsFrame(dogsFrame);
    showDogsMenu("store");
    pushTrace(`EutherDogs mission ${selectedDogsMission} ready`);
  } catch (err) {
    pushTrace(`EutherDogs next mission failed: ${err instanceof Error ? err.message : String(err)}`);
    renderDogsMenu();
  }
}

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.8;
  }
  return Math.min(1, Math.max(0, value));
}

function clampMicVolume(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.min(1.6, Math.max(0, value));
}

function readStoredMobileMode(): boolean {
  const stored = localStorage.getItem(mobileModeStorageKey);
  if (stored === "1") {
    return true;
  }
  return false;
}

function readStoredDogsAssetMode(): DogsAssetMode {
  return localStorage.getItem(dogsAssetModeStorageKey) === "2x" ? "2x" : "classic";
}

function setMobileMode(enabled: boolean): void {
  mobileMode = enabled;
  localStorage.setItem(mobileModeStorageKey, enabled ? "1" : "0");
  resetScheduledAudio();
  applyMobileMode();
}

function applyMobileMode(): void {
  document.body.classList.toggle("mobile-play-mode", mobileMode);
  mobileToggle.classList.toggle("is-active", mobileMode);
  mobileToggle.setAttribute("aria-pressed", mobileMode ? "true" : "false");
  mobileToggle.textContent = mobileMode ? "Desk" : "Mobile";
  ui.audioLeadMs = 0;
}

function setDogsAssetMode(mode: DogsAssetMode): void {
  if (dogsAssetMode === mode) {
    return;
  }
  dogsAssetMode = mode;
  localStorage.setItem(dogsAssetModeStorageKey, mode);
  dogsImageCache.clear();
  dogsImageLoadPromises.clear();
  dogsSfxCache.clear();
  dogsPreloadedAssetMode = null;
  dogsPreloadedAudioKey = null;
  dogsPreloadProgress = null;
  renderDogsPreloadOverlay();
  applyEutherDogsCssAssets();
  preloadDogsCombatAssets();
  renderDogsAssetMode();
  if (dogsMode && dogsFrame) {
    drawDogsFrame(dogsFrame);
    renderDogsMenu();
  }
}

function renderDogsAssetMode(): void {
  dogsAssetModeButtons.forEach((button) => {
    const selected = button.dataset.dogsAssetMode === dogsAssetMode;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", selected ? "true" : "false");
  });
}

async function ensureCivetHostSession(): Promise<void> {
  if (isTauri || !hostedServerMode) {
    return;
  }
  await refreshAuthStatus();
  if (!hostUsername) {
    throw new Error("login required");
  }
  if (!hostPermissions.canPlay) {
    throw new Error("Play permission required");
  }
}

function renderCivetBevyGame(reload = false): void {
  const existing = eutherCivetWorld.querySelector<HTMLIFrameElement>(".euthercivet-game-frame");
  if (existing && !reload) {
    return;
  }
  const cacheKey = reload ? `?reload=${Date.now()}` : "";
  eutherCivetWorld.innerHTML = `<iframe class="euthercivet-game-frame" title="EutherCivet" src="${eutherCivetGameUrl}${cacheKey}" allow="autoplay; fullscreen; gamepad" loading="eager"></iframe>`;
  eutherCivetTitle.textContent = "EutherCivet";
  eutherCivetStatus.textContent = "Bevy runtime";
  eutherCivetBars.innerHTML = "";
  eutherCivetStats.innerHTML = "";
  eutherCivetActions.innerHTML = "";
  eutherCivetLog.innerHTML = "";
}

async function enterCivetMode(): Promise<void> {
  if (civetMode) {
    return;
  }
  if (dogsMode) {
    leaveDogsMode();
  }
  civetMode = true;
  resetScheduledAudio();
  stopBridgeStream();
  ui.playing = true;
  Object.assign(ui, {
    loaded: true,
    runtime: isTauri ? ("tauri" as const) : ui.runtime === "bridge" ? ("bridge" as const) : ("web" as const),
    title: "EutherCivet",
    region: "ESTATE",
    timing: "BEVY",
    resetPc: 0,
    width: 960,
    height: 540,
    cpuCycles: 0,
    cpuSteps: 0,
    frameMs: 0,
    transportMode: "CIVET BEVY",
    status: "CIVET WARMUP",
    lastError: "",
  });
  playToggle.textContent = "Pause";
  document.body.classList.add("euthercivet-mode");
  eutherCivetRenderer.setAttribute("aria-hidden", "false");
  try {
    await ensureCivetHostSession();
    renderCivetBevyGame();
    ui.frame = 0;
    ui.status = "CIVET BEVY";
    pushTrace("EutherCivet Bevy runtime started");
  } catch (err) {
    civetMode = false;
    document.body.classList.remove("euthercivet-mode");
    eutherCivetRenderer.setAttribute("aria-hidden", "true");
    ui.loaded = false;
    ui.playing = false;
    playToggle.textContent = "Play";
    ui.status = "CIVET ERROR";
    ui.lastError = err instanceof Error ? err.message : String(err);
    pushTrace(`EutherCivet failed: ${ui.lastError}`);
  }
  renderUi();
}

function leaveCivetMode(): void {
  civetMode = false;
  ui.playing = false;
  ui.loaded = false;
  ui.title = "No ROM";
  ui.status = "IDLE";
  playToggle.textContent = "Play";
  document.body.classList.remove("euthercivet-mode");
  eutherCivetRenderer.setAttribute("aria-hidden", "true");
  eutherCivetWorld.innerHTML = "";
  drawSyntheticFrame();
  renderUi();
}

async function resetCivetMode(): Promise<void> {
  ui.playing = true;
  playToggle.textContent = "Pause";
  renderCivetBevyGame(true);
  ui.frame = 0;
  ui.status = "CIVET BEVY";
  renderUi();
}

async function enterDogsMode(): Promise<void> {
  dogsMode = true;
  updateStartupModePreference("dogs");
  resetScheduledAudio();
  stopBridgeStream();
  try {
    ui.status = "DOGS WARMUP";
    renderUi();
    await preloadDogsVisualAssets();
    dogsFrame = await startDogsCore();
    selectedDogsMission = dogsFrame.summary.mission || selectedDogsMission;
    await loadDogsHighScoresToml();
  } catch (err) {
    dogsMode = false;
    pushTrace(`EutherDogs core failed: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  Object.assign(ui, {
    loaded: true,
    playing: false,
    runtime: isTauri ? ("tauri" as const) : ui.runtime === "bridge" ? ("bridge" as const) : ("web" as const),
    title: "EutherDogs",
    region: "RX",
    timing: "60HZ",
    resetPc: 0,
    width: dogsCanvas.width,
    height: dogsCanvas.height,
    frame: 0,
    cpuCycles: 0,
    cpuSteps: 0,
    frameMs: 16.67,
    transportMode: "DOGS CORE",
    status: "DOGS READY",
    lastError: "",
  });
  playToggle.textContent = "Play";
  document.body.classList.add("eutherdogs-mode");
  eutherDogsConsole.setAttribute("aria-hidden", "false");
  eutherDogsToggle.classList.add("is-active");
  dogsLastExitReady = dogsExitReady(dogsFrame);
  dogsLastPortalHumFrame = -9999;
  dogsPreviousAudioFrame = dogsFrame;
  playDogsMissionMusic(dogsFrame.summary.mission);
  drawDogsFrame(dogsFrame);
  showDogsMenu("staff");
  renderUi();
  pushTrace("EutherDogs Rust core started");
}

function leaveDogsMode(): void {
  dogsMode = false;
  updateStartupModePreference("megadrive");
  hideDogsInventory();
  if (controlsOpen) {
    closeControls();
  }
  stopDogsSnapshotStream();
  stopDogsMusic();
  dogsLastExitReady = false;
  dogsLastPortalHumFrame = -9999;
  dogsPreviousAudioFrame = null;
  dogsInspectionAlertStartFrame = -1;
  dogsInspectionAlertUntilFrame = -1;
  dogsInspectionAlertTitle = "INSPECTION!!!";
  dogsInspectionAlertSubtitle = "RETAIL COMPLIANCE BREACH";
  dogsSawHostileQueue = false;
  ui.playing = false;
  ui.loaded = false;
  ui.title = "No ROM";
  ui.status = "IDLE";
  playToggle.textContent = "Play";
  document.body.classList.remove("eutherdogs-mode");
  eutherDogsConsole.setAttribute("aria-hidden", "true");
  hideDogsMenu();
  eutherDogsToggle.classList.remove("is-active");
  drawSyntheticFrame();
  renderUi();
}

function resetDogsMode(): void {
  ui.playing = false;
  ui.frame = 0;
  ui.status = "DOGS RESET";
  dogsSubmittedHighscoreFrame = null;
  dogsPendingHighscoreFrame = null;
  dogsHighscoreSavedName = null;
  playToggle.textContent = "Play";
  void resetDogsCore()
    .then((frame) => {
      dogsFrame = frame;
      playDogsMissionMusic(frame.summary.mission);
      drawDogsFrame(frame);
      renderUi();
    })
    .catch((err) => {
      ui.status = "DOGS ERROR";
      ui.lastError = err instanceof Error ? err.message : String(err);
      renderUi();
    });
}

async function runDogsFrame(): Promise<void> {
  const started = performance.now();
  const previousFrameNumber = dogsFrame?.frame ?? -1;
  let fetched = started;
  try {
    dogsFrame = await runDogsCoreFrame();
    fetched = performance.now();
    if (!dogsStream || dogsFrame.frame !== previousFrameNumber) {
      lastDogsSnapshotAt = fetched;
    }
    dogsSnapshotMisses = 0;
  } catch (err) {
    fetched = performance.now();
    dogsSnapshotMisses += 1;
    if (!dogsFrame) {
      throw err;
    }
    const drawStarted = performance.now();
    drawDogsFrame(dogsFrame);
    const held = performance.now();
    ui.frame = dogsFrame.frame;
    ui.transportMs = fetched - started;
    ui.drawMs = held - drawStarted;
    ui.transportMode = `DOGS HOLD ${dogsSnapshotMisses}`;
    ui.status = `DOGS ${dogsFrame.summary.status.toUpperCase()}`;
    return;
  }
  if (dogsFrame.frame !== lastDogsProcessedFrame) {
    processDogsAudio(dogsFrame);
    resolveDogsLocalExit(dogsFrame);
    lastDogsProcessedFrame = dogsFrame.frame;
  }
  const drawStarted = performance.now();
  drawDogsFrame(dogsFrame);
  const done = performance.now();
  ui.frame = dogsFrame.frame;
  ui.cpuCycles = dogsFrame.characters.filter((actor) => actor.faction !== "player" && actor.alive).length;
  ui.cpuSteps = dogsFrame.bullets.length;
  ui.frameMs = 16.67;
  ui.transportMs = fetched - started;
  ui.drawMs = done - drawStarted;
  ui.audioLeadMs = 0;
  ui.status = `DOGS ${dogsFrame.summary.status.toUpperCase()}`;
  if (dogsFrame.summary.status !== "running") {
    queueDogsHighScore(dogsFrame);
    void playDogsMusic(dogsFrame.summary.status === "won" ? "success" : "failure", 0.38);
    ui.playing = false;
    playToggle.textContent = "Play";
    stopDogsSnapshotStream();
    showDogsMenu("result");
  }
}

function startDogsSnapshotStream(): void {
  if (isTauri || ui.runtime !== "bridge" || dogsStream) {
    return;
  }
  dogsStream = new EventSource(bridgeUrl(`/eutherdogs/stream?player=${playerPort}`), {
    withCredentials: true,
  });
  dogsStream.onmessage = (event) => {
    try {
      dogsFrame = mergeDogsStreamFrame(dogsFrame, JSON.parse(event.data) as DogsStreamFrame | DogsCompactStreamFrame);
      dogsLastAckedInputSeq = dogsFrame.ackedInputSeq ?? dogsLastAckedInputSeq;
      lastDogsSnapshotAt = performance.now();
      dogsSnapshotMisses = 0;
      ui.transportMode = "DOGS SSE";
    } catch (err) {
      ui.lastError = err instanceof Error ? err.message : String(err);
    }
  };
  dogsStream.onerror = () => {
    dogsSnapshotMisses += 1;
    ui.transportMode = `DOGS SSE HOLD ${dogsSnapshotMisses}`;
  };
}

function mergeDogsStreamFrame(previous: DogsCoreFrame | null, raw: DogsStreamFrame | DogsCompactStreamFrame): DogsCoreFrame {
  const patch = decodeDogsStreamFrame(raw, previous);
  if (!previous && (!patch.tiles || !patch.visibility || !patch.store)) {
    throw new Error("EutherDogs stream missing initial static state");
  }
  const base = previous as DogsCoreFrame;
  return {
    frame: patch.frame,
    width: patch.width ?? base.width,
    height: patch.height ?? base.height,
    tileWidth: patch.tileWidth ?? base.tileWidth,
    tileHeight: patch.tileHeight ?? base.tileHeight,
    characterWidth: patch.characterWidth ?? base.characterWidth,
    characterHeight: patch.characterHeight ?? base.characterHeight,
    tiles: patch.tiles ?? base.tiles,
    visibility: patch.visibility ?? base.visibility,
    characters: patch.characters ?? base.characters,
    bullets: patch.bullets ?? base.bullets,
    inspectionDialogues: patch.inspectionDialogues ?? base.inspectionDialogues ?? [],
    summary: patch.summary ?? base.summary,
    store: patch.store ?? base.store,
    audioEvents: patch.audioEvents ?? [],
    highscoreCount: patch.highscoreCount ?? base.highscoreCount,
    ackedInputSeq: patch.ackedInputSeq ?? base.ackedInputSeq,
  };
}

function decodeDogsStreamFrame(raw: DogsStreamFrame | DogsCompactStreamFrame, previous: DogsCoreFrame | null): DogsStreamFrame {
  if (!("compact" in raw) && !("c" in raw) && !("b" in raw) && !("s" in raw)) {
    return raw as DogsStreamFrame;
  }
  const compact = raw as DogsCompactStreamFrame;
  const characters = decodeDogsActorPatch(previous?.characters ?? [], compact);
  const bullets = decodeDogsBulletPatch(previous?.bullets ?? [], compact);
  return {
    ...compact,
    frame: compact.frame,
    characters,
    bullets,
    inspectionDialogues: (compact.d ?? [])
      .map(decodeDogsInspectionDialogueRow)
      .filter((dialogue): dialogue is DogsInspectionDialogue => dialogue !== null),
    summary: compact.s ? decodeDogsSummaryRow(compact.s) : previous?.summary,
    audioEvents: compact.a ?? [],
    highscoreCount: compact.h ?? compact.highscoreCount ?? 0,
    ackedInputSeq: compact.q ?? compact.ackedInputSeq,
  };
}

function decodeDogsActorPatch(previous: DogsCoreActor[], compact: DogsCompactStreamFrame): DogsCoreActor[] {
  if (compact.c) {
    return compact.c.map(decodeDogsActorRow).filter((actor): actor is DogsCoreActor => actor !== null);
  }
  const actors = new Map(previous.map((actor) => [dogsActorWireKey(actor), actor]));
  for (const key of compact.ar ?? []) {
    actors.delete(String(key));
  }
  for (const actor of (compact.ac ?? []).map(decodeDogsActorRow)) {
    if (actor) {
      actors.set(dogsActorWireKey(actor), actor);
    }
  }
  return Array.from(actors.values());
}

function decodeDogsBulletPatch(previous: DogsCoreBullet[], compact: DogsCompactStreamFrame): DogsCoreBullet[] {
  if (compact.b) {
    return compact.b.map(decodeDogsBulletRow).filter((bullet): bullet is DogsCoreBullet => bullet !== null);
  }
  const bullets = new Map(previous.map((bullet) => [bullet.id, bullet]));
  for (const id of compact.br ?? []) {
    bullets.delete(Number(id));
  }
  for (const bullet of (compact.bc ?? []).map(decodeDogsBulletRow)) {
    if (bullet) {
      bullets.set(bullet.id, bullet);
    }
  }
  return Array.from(bullets.values());
}

function dogsActorWireKey(actor: Pick<DogsCoreActor, "faction" | "id">): string {
  return `${actor.faction}:${actor.id}`;
}

function decodeDogsActorRow(row: unknown): DogsCoreActor | null {
  if (!Array.isArray(row) || row.length < 11) {
    return null;
  }
  return {
    id: Number(row[0]),
    faction: String(row[1]),
    x: Number(row[2]),
    y: Number(row[3]),
    direction: String(row[4]),
    sprite: String(row[5]),
    armor: Number(row[6]),
    lives: Number(row[7]),
    alive: Boolean(row[8]),
    activeWeapon: String(row[9]),
    ammo: Number(row[10]),
  };
}

function decodeDogsBulletRow(row: unknown): DogsCoreBullet | null {
  if (!Array.isArray(row) || row.length < 7) {
    return null;
  }
  return {
    id: Number(row[0]),
    x: Number(row[1]),
    y: Number(row[2]),
    dx: Number(row[3]),
    dy: Number(row[4]),
    ownerFaction: String(row[5]),
    weapon: String(row[6]),
  };
}

function decodeDogsInspectionDialogueRow(row: unknown): DogsInspectionDialogue | null {
  if (!Array.isArray(row) || row.length < 4) {
    return null;
  }
  return {
    player: Number(row[0]),
    inspectorId: Number(row[1]),
    question: String(row[2]),
    complete: Boolean(row[3]),
  };
}

function decodeDogsSummaryRow(row: unknown): DogsCoreSummary {
  const values = Array.isArray(row) ? row : [];
  return {
    mission: Number(values[0] ?? 0),
    maxMission: Number(values[1] ?? 0),
    status: String(values[2] ?? "running"),
    elapsedTicks: Number(values[3] ?? 0),
    score: Number(values[4] ?? 0),
    cash: Number(values[5] ?? 0),
    kills: Number(values[6] ?? 0),
    targetsDestroyed: Number(values[7] ?? 0),
    objectsCollected: Number(values[8] ?? 0),
    shotsFired: Number(values[9] ?? 0),
    hits: Number(values[10] ?? 0),
    damageTaken: Number(values[11] ?? 0),
    targetsLeft: Number(values[12] ?? 0),
    objectsLeft: Number(values[13] ?? 0),
    minimumKills: Number(values[14] ?? 0),
    timeRemainingTicks: values[15] == null ? null : Number(values[15]),
    bossActive: Boolean(values[16]),
    bossName: values[17] == null ? null : String(values[17]),
    bossArmor: values[18] == null ? null : Number(values[18]),
    bossMaxArmor: values[19] == null ? null : Number(values[19]),
    routineRead: Number(values[20] ?? 0),
    routineTotal: Number(values[21] ?? 0),
    inspectionAnswers: Number(values[22] ?? 0),
    inspectionProtocol: Number(values[23] ?? 0),
  };
}

function stopDogsSnapshotStream(): void {
  dogsStream?.close();
  dogsStream = null;
}

function resetDogsRuntimeCaches(stopStream: boolean): void {
  dogsPreviousActorPositions = new Map();
  dogsRenderActorPositions = new Map();
  dogsLastRenderAt = performance.now();
  dogsActorFacings = new Map();
  dogsLastExitReady = false;
  dogsLastPortalHumFrame = -9999;
  dogsPreviousAudioFrame = null;
  dogsSawHostileQueue = false;
  dogsTrackedBullets = new Map();
  dogsImpactEffects = [];
  dogsLastImpactFrameProcessed = -1;
  dogsSubmittedHighscoreFrame = null;
  dogsPendingHighscoreFrame = null;
  dogsHighscoreSavedName = null;
  lastDogsInputJson = "";
  lastDogsInputSentAt = 0;
  lastDogsSnapshotAt = 0;
  dogsSnapshotMisses = 0;
  lastDogsProcessedFrame = -1;
  dogsInputSeq = 0;
  dogsLastAckedInputSeq = 0;
  dogsFireArmed = true;
  dogsLastLocalShotAt = 0;
  dogsLastLocalShotSound = null;
  dogsLastHudMarkup = "";
  if (stopStream) {
    stopDogsSnapshotStream();
  }
}

async function startDogsCore(): Promise<DogsCoreFrame> {
  const start = {
    staff: selectedDogsStaff,
    mission: selectedDogsMission,
    players: 2,
    characters: [selectedDogsCharacters[1], selectedDogsCharacters[2]],
  };
  resetDogsRuntimeCaches(true);
  if (isTauri) {
    return await invoke<DogsCoreFrame>("start_eutherdogs", { start });
  }
  if (ui.runtime !== "bridge") {
    await connectBridge(false);
  }
  if (ui.runtime === "bridge") {
    return await bridgeJson<DogsCoreFrame>("/eutherdogs/start", {
      method: "POST",
      body: JSON.stringify(start),
    });
  }
  throw new Error("starta web bridge eller Tauri for Rust-core demo");
}

async function nextDogsCoreMission(): Promise<DogsCoreFrame> {
  resetDogsRuntimeCaches(true);
  if (isTauri) {
    return await invoke<DogsCoreFrame>("advance_eutherdogs_mission");
  }
  if (ui.runtime !== "bridge") {
    await connectBridge(false);
  }
  if (ui.runtime === "bridge") {
    return await bridgeJson<DogsCoreFrame>("/eutherdogs/next", { method: "POST" });
  }
  throw new Error("starta web bridge eller Tauri for Rust-core demo");
}

async function resetDogsCore(): Promise<DogsCoreFrame> {
  resetDogsRuntimeCaches(true);
  if (isTauri) {
    return await invoke<DogsCoreFrame>("reset_eutherdogs");
  }
  return await bridgeJson<DogsCoreFrame>("/eutherdogs/reset", { method: "POST" });
}

async function runDogsCoreFrame(): Promise<DogsCoreFrame> {
  const input = dogsInputForFrame(true);
  if (isTauri) {
    return await invoke<DogsCoreFrame>("run_eutherdogs_frame", { input });
  }
  if (dogsStream && dogsFrame) {
    void syncDogsBridgeInput(input).catch((err) => {
      dogsSnapshotMisses += 1;
      ui.transportMode = "DOGS INPUT HOLD";
      ui.lastError = err instanceof Error ? err.message : String(err);
    });
    const age = performance.now() - lastDogsSnapshotAt;
    if (age > 450) {
      stopDogsSnapshotStream();
      ui.transportMode = "DOGS SSE RESTART";
      startDogsSnapshotStream();
    }
    if (age > 90) {
      return await bridgeJson<DogsCoreFrame>(`/eutherdogs/snapshot?player=${playerPort}`, {}, 180);
    }
    return dogsFrame;
  }
  await syncDogsBridgeInput(input);
  const now = performance.now();
  if (dogsFrame && now - lastDogsSnapshotAt < 50) {
    return dogsFrame;
  }
  return await bridgeJson<DogsCoreFrame>(`/eutherdogs/snapshot?player=${playerPort}`, {}, 180);
}

function dogsInputForFrame(includeSeq = false): DogsBridgeInput {
  const input: DogsBridgeInput = { ...inputState, player: playerPort };
  const fireHeld = input.a || input.b;
  if (!fireHeld) {
    dogsFireArmed = true;
  } else if (!dogsFireArmed) {
    input.a = false;
    input.b = false;
  } else {
    dogsFireArmed = false;
    playDogsLocalShotFeedback();
  }
  if (includeSeq) {
    input.seq = dogsInputSeq;
  }
  return input;
}

async function syncDogsWeaponSlot(slot: number): Promise<void> {
  try {
    await syncDogsBridgeInput({ ...dogsInputForFrame(), weaponSlot: slot });
    pushTrace(`EutherDogs weapon slot ${slot + 1}`);
  } catch (err) {
    dogsSnapshotMisses += 1;
    ui.transportMode = "DOGS INPUT HOLD";
    ui.lastError = err instanceof Error ? err.message : String(err);
  }
}

async function answerDogsInspection(answer: "yes" | "no" | "other"): Promise<void> {
  try {
    await syncDogsBridgeInput({ ...dogsInputForFrame(), inspectionAnswer: answer });
    pushTrace(`Inspection answer ${answer.toUpperCase()}`);
  } catch (err) {
    dogsSnapshotMisses += 1;
    ui.transportMode = "DOGS INSPECTION HOLD";
    ui.lastError = err instanceof Error ? err.message : String(err);
  }
}

async function syncDogsBridgeInput(input: DogsBridgeInput): Promise<void> {
  const now = performance.now();
  const changedInput = { ...input, seq: undefined };
  const nextState = JSON.stringify(changedInput);
  if (nextState === lastDogsInputJson && now - lastDogsInputSentAt < 120) {
    return;
  }
  if (nextState !== lastDogsInputJson) {
    dogsInputSeq += 1;
  }
  const payload = { ...input, seq: dogsInputSeq };
  const next = JSON.stringify(payload);
  lastDogsInputJson = nextState;
  lastDogsInputSentAt = now;
  await bridgeRequest("/eutherdogs/input", {
    method: "POST",
    body: next,
  }, 180);
}

async function purchaseDogsCoreItem(itemId: string): Promise<DogsCoreFrame> {
  const purchase = { itemId, player: playerPort };
  if (isTauri) {
    return await invoke<DogsCoreFrame>("purchase_eutherdogs_item", { purchase });
  }
  return await bridgeJson<DogsCoreFrame>("/eutherdogs/purchase", {
    method: "POST",
    body: JSON.stringify(purchase),
  });
}

function drawDogsFrame(frame: DogsCoreFrame | null): void {
  const renderNow = performance.now();
  const visualFrame = Math.floor(renderNow / (1000 / 60));
  dogsInspectionAnswerRects = [];
  dogsContext.fillStyle = "#07100d";
  dogsContext.fillRect(0, 0, dogsCanvas.width, dogsCanvas.height);
  if (!frame) {
    dogsLastRenderAt = renderNow;
    return;
  }

  const worldW = frame.width * frame.tileWidth;
  const worldH = frame.height * frame.tileHeight;
  const serverPlayer = dogsLocalPlayer(frame);
  const localPlayerTarget = predictedDogsActor(serverPlayer);
  const localPlayer =
    localPlayerTarget && serverPlayer
      ? smoothDogsActor(localPlayerTarget, true)
      : undefined;
  const player = localPlayer ?? frame.characters[0];
  const yScale = eutherDogsRenderYScale;
  const scale = Math.max(
    0.18,
    Math.min(
      dogsCanvas.width / eutherDogsCameraWorldWidth,
      dogsCanvas.height / (eutherDogsCameraWorldHeight * yScale),
    ),
  );
  const viewW = dogsCanvas.width / scale;
  const viewH = dogsCanvas.height / (scale * yScale);
  const cameraX = Math.max(0, Math.min(worldW - viewW, (player?.x ?? 0) - viewW / 2));
  const rawCameraY = Math.max(0, Math.min(worldH - viewH, (player?.y ?? 0) - viewH / 2));
  const playerY = player?.y ?? 0;
  const playerScreenY = (playerY - rawCameraY) * yScale * scale;
  const safeTop = eutherDogsTopHudSafePx + frame.characterHeight * scale * 0.25;
  const safeBottom = dogsCanvas.height - eutherDogsBottomHudSafePx - frame.characterHeight * scale;
  const cameraY =
    playerScreenY < safeTop
      ? Math.max(0, Math.min(worldH - viewH, playerY - safeTop / (scale * yScale)))
      : playerScreenY > safeBottom
        ? Math.max(0, Math.min(worldH - viewH, playerY - safeBottom / (scale * yScale)))
        : rawCameraY;
  const firstTileX = Math.max(0, Math.floor(cameraX / frame.tileWidth));
  const firstTileY = Math.max(0, Math.floor(cameraY / frame.tileHeight));
  const lastTileX = Math.min(frame.width - 1, Math.ceil((cameraX + viewW) / frame.tileWidth));
  const lastTileY = Math.min(frame.height - 1, Math.ceil((cameraY + viewH) / frame.tileHeight));
  const queueLeft = dogsQueueLeft(frame);
  const exitReady = dogsExitReadyForQueue(frame, queueLeft);
  drawDogsVisibleTiles(
    frame,
    cameraX,
    cameraY,
    scale,
    yScale,
    firstTileX,
    firstTileY,
    lastTileX,
    lastTileY,
    exitReady,
    visualFrame,
  );
  const nextActorPositions = new Map<string, { x: number; y: number }>();
  const nextActorFacings = new Map<string, DogsActorFacing>();
  const localPlayerId = player?.faction === "player" ? player.id : null;
  for (const serverActor of frame.characters) {
    const isLocalPlayer = serverActor.id === localPlayerId && serverActor.faction === "player";
    const targetActor = isLocalPlayer
      ? localPlayerTarget ?? serverActor
      : serverActor;
    const actor = isLocalPlayer && localPlayer
      ? localPlayer
      : smoothDogsActor(targetActor, false);
    if (!actor.alive) continue;
    if (actor.faction === "player" && actor.id !== localPlayerId && dogsPixelVisibility(frame, actor.x, actor.y) < 255) {
      continue;
    }
    if (actor.faction !== "player" && dogsPixelVisibility(frame, actor.x, actor.y) < 255) continue;
    const enemyKey = actor.faction !== "player" ? dogsEnemyKey(actor) : "";
    const spriteUnit = enemyKey === "senior_lma" ? 56 : enemyKey === "mpa_chief" ? 46 : enemyKey === "district_manager" ? 44 : 32;
    const spriteW = Math.max(8, Math.ceil(spriteUnit * scale));
    const spriteH = Math.max(8, Math.ceil(spriteUnit * scale));
    const bodyW = frame.characterWidth * scale;
    const bodyH = frame.characterHeight * yScale * scale;
    const x = Math.floor((actor.x - cameraX) * scale - (spriteW - bodyW) / 2);
    const y = Math.floor((actor.y - cameraY) * yScale * scale - Math.max(0, spriteH - bodyH));
    const actorKey = `${actor.faction}:${actor.id}`;
    const serverPrevious = dogsPreviousActorPositions.get(actorKey);
    const moving = Boolean(serverPrevious && (serverPrevious.x !== targetActor.x || serverPrevious.y !== targetActor.y));
    const serverFacing = dogsActorDirectionFacing(actor);
    const fallbackFacing = dogsActorFacings.get(actorKey) ?? serverFacing;
    const facing = serverPrevious
      ? moving
        ? dogsFacingFromMovement(targetActor.x - serverPrevious.x, targetActor.y - serverPrevious.y, fallbackFacing)
        : serverFacing
      : serverFacing;
    nextActorPositions.set(actorKey, { x: targetActor.x, y: targetActor.y });
    nextActorFacings.set(actorKey, facing);
    const sheetAsset = dogsActorSheetAsset(actor);
    if (sheetAsset) {
      const frameColumn = moving ? Math.floor(visualFrame / 8) % 3 : 1;
      const frameRow = dogsActorFacingRow(facing);
      const sheetFrameSize = dogsAssetMode === "2x" ? 64 : 32;
      const drewFrame = drawDogsImageFrame(
        sheetAsset,
        frameColumn * sheetFrameSize,
        frameRow * sheetFrameSize,
        sheetFrameSize,
        sheetFrameSize,
        x,
        y,
        spriteW,
        spriteH,
        actor.faction === "player" ? "#27f2ff" : "#f04444",
      );
      if (!drewFrame) {
        drawDogsImage(dogsActorAsset(actor), x, y, spriteW, spriteH, actor.faction === "player" ? "#27f2ff" : "#f04444");
      }
    } else {
      drawDogsImage(dogsActorAsset(actor), x, y, spriteW, spriteH, "#f04444");
    }
  }
  dogsPreviousActorPositions = nextActorPositions;
  dogsActorFacings = nextActorFacings;
  for (const actorKey of Array.from(dogsRenderActorPositions.keys())) {
    if (!nextActorPositions.has(actorKey)) {
      dogsRenderActorPositions.delete(actorKey);
    }
  }
  updateDogsImpactEffects(frame);
  drawDogsImpactEffects(frame, cameraX, cameraY, scale, yScale);
  for (const bullet of frame.bullets) {
    if (bullet.ownerFaction !== "player" && dogsPixelVisibility(frame, bullet.x, bullet.y) < 255) continue;
    drawDogsProjectile(bullet, cameraX, cameraY, scale, yScale, visualFrame);
  }
  drawDogsVisibilityFog(frame, cameraX, cameraY, scale, yScale, firstTileX, firstTileY, lastTileX, lastTileY);
  drawDogsInspectionDialogues(frame, cameraX, cameraY, scale, yScale);
  if (dogsMapOpen) {
    drawDogsMapOverlay(frame, cameraX, cameraY, viewW, viewH);
  }
  drawDogsInspectionOverlay(frame, viewW, viewH);
  const hero = dogsLocalPlayer(frame);
  const ammo = hero?.ammo ?? -1;
  const bossActive = Boolean(frame.summary.bossActive);
  const bossArmor = Math.max(0, frame.summary.bossArmor ?? 0);
  const bossMaxArmor = Math.max(1, frame.summary.bossMaxArmor ?? 1);
  const bossPercent = Math.round(Math.min(100, (bossArmor / bossMaxArmor) * 100));
  const bossName = escapeHtml(frame.summary.bossName ?? "NGR3");
  const status = escapeHtml(frame.summary.status.toUpperCase());
  const routineTotal = frame.summary.routineTotal ?? 0;
  const routineText = routineTotal > 0
    ? ` | RUTINE ${frame.summary.routineRead ?? 0}/${routineTotal} READ`
    : "";
  const inspectionText = (frame.summary.inspectionAnswers ?? 0) > 0 || (frame.summary.inspectionProtocol ?? 0) > 0
    ? ` | INSPECT ${frame.summary.inspectionAnswers ?? 0}/10 | PROTOCOL ${frame.summary.inspectionProtocol ?? 0}`
    : "";
  const hudMarkup = `
    <span class="eutherdogs-hud-main">COAT ${hero?.armor ?? 0} | CASH $${frame.summary.cash} | SCORE ${frame.summary.score} | RX ${frame.summary.objectsLeft} | QUEUE <strong class="eutherdogs-queue${bossActive ? " is-boss" : ""}">${queueLeft}</strong>${routineText}${inspectionText} | AMMO ${ammo < 0 ? "INF" : ammo} | ${status}</span>
    ${bossActive ? `<span class="eutherdogs-boss"><strong>BOSS:${bossName}</strong><span class="eutherdogs-boss-bar"><span style="width: ${bossPercent}%"></span></span></span>` : ""}
  `;
  if (hudMarkup !== dogsLastHudMarkup) {
    dogsLastHudMarkup = hudMarkup;
    eutherDogsHud.innerHTML = hudMarkup;
  }
  updateDogsConsole(frame);
  if (dogsInventoryOpen) {
    renderDogsInventoryPopup();
  }
  dogsLastRenderAt = renderNow;
}

function readStoredPlayerPort(): PlayerPort {
  return localStorage.getItem(playerPortStorageKey) === "2" ? 2 : 1;
}

function readStoredDogsCharacters(): Record<PlayerPort, DogsCharacterKey> {
  try {
    const parsed = JSON.parse(localStorage.getItem(dogsCharactersStorageKey) ?? "{}") as Partial<Record<PlayerPort, string>>;
    return {
      1: parsed[1] === "neon_pharmacist" ? "neon_pharmacist" : "night_shift_tech",
      2: parsed[2] === "night_shift_tech" ? "night_shift_tech" : "neon_pharmacist",
    };
  } catch {
    return { 1: "night_shift_tech", 2: "neon_pharmacist" };
  }
}

function writeStoredDogsCharacters(): void {
  localStorage.setItem(dogsCharactersStorageKey, JSON.stringify(selectedDogsCharacters));
}

function setPlayerPort(port: PlayerPort): void {
  if (playerPort === port) {
    return;
  }
  playerPort = port;
  localStorage.setItem(playerPortStorageKey, String(port));
  lastInputJson = "";
  lastDogsInputJson = "";
  dogsInputSeq = 0;
  dogsLastAckedInputSeq = 0;
  if (dogsMode && ui.runtime === "bridge") {
    stopDogsSnapshotStream();
    if (ui.playing) {
      startDogsSnapshotStream();
    }
  }
  resetScheduledAudio();
  if (ui.runtime === "bridge" && ui.playing && !bridgePlaybackStarting) {
    stopBridgeStream();
    void startBridgePlayback();
  }
  renderPlayerPort();
}

function renderPlayerPort(): void {
  playerPortButtons.forEach((button) => {
    const selected = Number(button.dataset.playerPort ?? 1) === playerPort;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", selected ? "true" : "false");
    button.disabled = claimedLobbyPlayer !== null && !selected;
    button.title =
      claimedLobbyPlayer === null ? "" : `Locked to claimed P${claimedLobbyPlayer}`;
  });
}

function setAudioVolume(value: number, persist = true): void {
  audioVolume = clampVolume(value);
  localStorage.setItem(volumeStorageKey, audioVolume.toString());
  updateVolumeUi();
  applyAudioVolume();
  if (persist) {
    scheduleUserPreferencesSave();
  }
}

function setMicVolume(value: number, persist = true): void {
  micVolume = clampMicVolume(value);
  localStorage.setItem(micVolumeStorageKey, micVolume.toString());
  updateMicVolumeUi();
  applyVideoChatMicVolume();
  if (persist) {
    scheduleUserPreferencesSave();
  }
}

function setDoomMouseSensitivity(value: number, persist = true): void {
  doomMouseSensitivity = clampDoomMouseSensitivity(value);
  localStorage.setItem(doomMouseSensitivityStorageKey, doomMouseSensitivity.toString());
  doomRendererController?.setMouseSensitivity?.(doomMouseSensitivity);
  eutherDukeFrame.contentWindow?.postMessage(
    { type: "eutherduke:setMouseSensitivity", value: doomMouseSensitivity },
    window.location.origin,
  );
  updateDoomMouseSensitivityUi();
  if (persist) {
    scheduleUserPreferencesSave();
  }
}

function setUserTheme(theme: UserTheme, persist = true): void {
  userTheme = theme;
  localStorage.setItem(userThemeStorageKey, userTheme);
  applyUserAppearance();
  if (persist) {
    scheduleUserPreferencesSave();
  }
}

function setUserSkin(skin: UserSkin, persist = true): void {
  userSkin = skin;
  localStorage.setItem(userSkinStorageKey, userSkin);
  applyUserAppearance();
  if (persist) {
    scheduleUserPreferencesSave();
  }
}

function applyUserAppearance(): void {
  document.body.dataset.userTheme = userTheme;
  document.body.dataset.userSkin = userSkin;
  document.documentElement.style.colorScheme = userTheme === "light" ? "light" : "dark";
  applyCustomUserSkin();
}

function applyCustomUserSkin(): void {
  const styleId = "custom-user-skin";
  let style = document.querySelector<HTMLStyleElement>(`#${styleId}`);
  if (userSkin !== "custom") {
    style?.remove();
    return;
  }
  const css = localStorage.getItem(customSkinCssStorageKey) ?? "";
  if (!css.trim()) {
    style?.remove();
    return;
  }
  if (!style) {
    style = document.createElement("style");
    style.id = styleId;
    document.head.appendChild(style);
  }
  style.textContent = css;
}

async function loadCustomUserSkin(file: File): Promise<void> {
  const css = await file.text();
  localStorage.setItem(customSkinCssStorageKey, css);
  setUserSkin("custom");
  renderWorkspaceWindow();
}

function clearCustomUserSkin(): void {
  localStorage.removeItem(customSkinCssStorageKey);
  setUserSkin("classic");
}

function updateVolumeUi(): void {
  volumeSlider.value = Math.round(audioVolume * 100).toString();
  volumeValue.textContent = `${Math.round(audioVolume * 100)}%`;
  const settingsVolumeSlider = document.querySelector<HTMLInputElement>("#settings-volume-slider");
  if (settingsVolumeSlider) {
    settingsVolumeSlider.value = Math.round(audioVolume * 100).toString();
  }
  const settingsVolumeValue = document.querySelector<HTMLElement>("#settings-volume-value");
  if (settingsVolumeValue) {
    settingsVolumeValue.textContent = `${Math.round(audioVolume * 100)}%`;
  }
}

function updateMicVolumeUi(): void {
  micVolumeSlider.value = Math.round(micVolume * 100).toString();
  micVolumeValue.textContent = `${Math.round(micVolume * 100)}%`;
  const settingsMicVolumeSlider = document.querySelector<HTMLInputElement>("#settings-mic-volume-slider");
  if (settingsMicVolumeSlider) {
    settingsMicVolumeSlider.value = Math.round(micVolume * 100).toString();
  }
  const settingsMicVolumeValue = document.querySelector<HTMLElement>("#settings-mic-volume-value");
  if (settingsMicVolumeValue) {
    settingsMicVolumeValue.textContent = `${Math.round(micVolume * 100)}%`;
  }
}

function updateDoomMouseSensitivityUi(): void {
  doomMouseSensitivityInput.value = doomMouseSensitivity.toFixed(1);
  doomMouseSensitivityValue.textContent = `${doomMouseSensitivity.toFixed(1)}x`;
}

function applyAudioVolume(): void {
  bridgeRtcAudio.volume = audioVolume;
  syncVideoChatMediaElements();
  if (audioGain && audioContext) {
    audioGain.gain.setTargetAtTime(audioVolume, audioContext.currentTime, 0.01);
  }
  if (isTauri) {
    void invoke("set_audio_volume", { volume: audioVolume });
  }
}

function applyVideoChatMicVolume(): void {
  if (videoChatMicGain && videoChatMicContext) {
    videoChatMicGain.gain.setTargetAtTime(micVolume, videoChatMicContext.currentTime, 0.01);
  }
}

async function unlockAudioFromSettings(): Promise<void> {
  if (audioVolume <= 0.001) {
    setAudioVolume(0.8);
  } else {
    applyAudioVolume();
  }
  await ensureAudio();
  resumeBridgeRtcAudio();
}

function resetScheduledAudio(): void {
  stopDogsMusic();
  for (const source of activeAudioSources) {
    try {
      source.stop();
    } catch {
      // Already ended or not started yet.
    }
  }
  activeAudioSources.clear();
  audioCursor = audioContext?.currentTime ?? 0;
  ui.audioLeadMs = 0;
}

async function ensureAudio(): Promise<AudioContext | null> {
  const AudioCtor = window.AudioContext ?? window.webkitAudioContext;
  if (!AudioCtor) {
    return null;
  }
  if (!audioContext) {
    audioContext = new AudioCtor();
    audioGain = audioContext.createGain();
    audioGain.connect(audioContext.destination);
    applyAudioVolume();
    audioCursor = audioContext.currentTime;
  }
  if (audioContext.state === "suspended") {
    void audioContext.resume().catch(() => undefined);
  }
  return audioContext;
}

async function scheduleAudioBatch(batch: AudioResult[]): Promise<number> {
  if (batch.length === 0) {
    return 0;
  }
  if (batch.length === 1) {
    return scheduleAudio(batch[0]);
  }
  const sampleRate = batch[0].sampleRate;
  const channels = Math.max(1, Math.floor(batch[0].channels ?? 1));
  let sampleCount = 0;
  for (const audio of batch) {
    if (audio.sampleRate !== sampleRate || Math.max(1, Math.floor(audio.channels ?? 1)) !== channels) {
      return scheduleAudio(batch[batch.length - 1]);
    }
    sampleCount += audio.samples.length;
  }
  const samples = new Int16Array(sampleCount);
  let offset = 0;
  for (const audio of batch) {
    const source =
      audio.samples instanceof Int16Array
        ? audio.samples
        : Int16Array.from(audio.samples);
    samples.set(source, offset);
    offset += source.length;
  }
  return scheduleAudio({
    frame: batch[batch.length - 1].frame,
    sampleRate,
    samples,
    channels,
  });
}

async function scheduleAudio(audio: AudioResult): Promise<number> {
  const samples =
    audio.samples instanceof Int16Array
      ? audio.samples
      : Int16Array.from(audio.samples);
  if (samples.length === 0) {
    return 0;
  }
  const channels = Math.max(1, Math.floor(audio.channels ?? 1));
  const frameCount = Math.floor(samples.length / channels);
  if (frameCount === 0) {
    return 0;
  }
  if (isTauri && ui.runtime === "tauri" && channels === 1) {
    try {
      const result = await invoke<NativeAudioResult>("play_native_audio", {
        samples: Array.from(samples),
        sampleRate: audio.sampleRate,
      });
      if (result.active) {
        return result.queuedMs;
      }
    } catch {
      pushTrace("Native audio warming");
    }
  }

  const context = await ensureAudio();
  if (!context) {
    return 0;
  }
  const timing = audioLeadTiming();
  const outputChannels = channels === 1 ? 1 : 2;
  const buffer = context.createBuffer(outputChannels, frameCount, audio.sampleRate);
  if (channels === 1) {
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < frameCount; index += 1) {
      channel[index] = samples[index] / 32768;
    }
  } else {
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    for (let index = 0; index < frameCount; index += 1) {
      const sampleOffset = index * channels;
      left[index] = samples[sampleOffset] / 32768;
      right[index] = samples[sampleOffset + 1] / 32768;
    }
  }

  const now = context.currentTime;
  if (audioCursor > now + timing.maximum) {
    resetScheduledAudio();
    audioCursor = now + timing.target;
  } else if (audioCursor < now + timing.minimum) {
    audioCursor = now + timing.target;
  }
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(audioGain ?? context.destination);
  activeAudioSources.add(source);
  source.onended = () => activeAudioSources.delete(source);
  source.start(audioCursor);
  const leadMs = Math.max(0, (audioCursor - now) * 1000);
  audioCursor += buffer.duration;
  return leadMs;
}

function audioLeadTiming(): { target: number; minimum: number; maximum: number } {
  if (ui.runtime === "bridge") {
    if (mobileMode) {
      return {
        target: mobileBridgeAudioTargetLeadSeconds,
        minimum: mobileBridgeAudioMinimumLeadSeconds,
        maximum: mobileBridgeAudioMaximumLeadSeconds,
      };
    }
    return {
      target: bridgeAudioTargetLeadSeconds,
      minimum: bridgeAudioMinimumLeadSeconds,
      maximum: bridgeAudioMaximumLeadSeconds,
    };
  }
  return {
    target: localAudioTargetLeadSeconds,
    minimum: localAudioMinimumLeadSeconds,
    maximum: localAudioMaximumLeadSeconds,
  };
}

function drawNativeFrame(frame: FrameResult): void {
  syncScreenGeometry(frame.width, frame.height);
  if (videoCanvas.width !== frame.width || videoCanvas.height !== frame.height) {
    videoCanvas.width = frame.width;
    videoCanvas.height = frame.height;
  }
  const image = new ImageData(
    framePixels(frame.rgba),
    frame.width,
    frame.height,
  );
  videoContext.putImageData(image, 0, 0);
  renderShaderFrame();
}

function syncBridgeVideoGeometry(): void {
  if (bridgeVideo.videoWidth > 0 && bridgeVideo.videoHeight > 0) {
    syncScreenGeometry(bridgeVideo.videoWidth, bridgeVideo.videoHeight);
  }
}

function syncScreenGeometry(width: number, height: number): void {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  ui.width = safeWidth;
  ui.height = safeHeight;
  screenGlass.style.setProperty("--screen-aspect-value", (safeWidth / safeHeight).toFixed(6));
  screenGlass.style.setProperty("--screen-aspect-ratio", `${safeWidth} / ${safeHeight}`);
}

function framePixels(
  rgba: number[] | Uint8Array<ArrayBufferLike> | Uint8ClampedArray<ArrayBufferLike>,
): Uint8ClampedArray<ArrayBuffer> {
  if (rgba instanceof Uint8ClampedArray) {
    return rgba as Uint8ClampedArray<ArrayBuffer>;
  }
  const bytes = rgba instanceof Uint8Array ? rgba : new Uint8Array(rgba);
  const pixels = new Uint8ClampedArray(bytes.byteLength) as Uint8ClampedArray<ArrayBuffer>;
  pixels.set(bytes);
  return pixels;
}

async function refreshStateSlots(): Promise<void> {
  if (isTauri && ui.runtime === "tauri" && ui.nativeStates) {
    try {
      applyStateSlots(await invoke<StateSlotsResult>("list_state_slots"));
      return;
    } catch (error) {
      ui.lastError = String(error);
    }
  } else if (ui.runtime === "bridge" && ui.nativeStates) {
    try {
      applyStateSlots(await bridgeJson<StateSlotsResult>("/states"));
      return;
    } catch (error) {
      ui.lastError = String(error);
    }
  }
  loadWebSlots();
}

async function saveStateSlot(slot: number): Promise<void> {
  if (!ui.loaded) {
    return;
  }
  if (isTauri && ui.runtime === "tauri" && ui.nativeStates) {
    try {
      applyStateSlots(await invoke<StateSlotsResult>("save_state_slot", { slot }));
      pushTrace(`Argon slot ${slot} sealed`);
      renderUi();
      return;
    } catch (error) {
      ui.lastError = String(error);
      pushTrace("Native argon save rejected");
    }
  } else if (ui.runtime === "bridge" && ui.nativeStates) {
    try {
      applyStateSlots(
        await bridgeJson<StateSlotsResult>(`/state/save?slot=${slot}`, {
          method: "POST",
        }),
      );
      pushTrace(`Argon slot ${slot} sealed`);
      renderUi();
      return;
    } catch (error) {
      ui.lastError = String(error);
      pushTrace("Bridge argon save rejected");
    }
  }

  const index = slot - 1;
  webStateSlots[index] = {
    frame: ui.frame,
    cpuCycles: ui.cpuCycles,
    cpuSteps: ui.cpuSteps,
    frameMs: ui.frameMs,
    status: ui.status,
  };
  persistWebSlots();
  ui.stateSlots = webSlotSummaries();
  pushTrace(`Web argon slot ${slot} held`);
  renderUi();
}

async function loadStateSlot(slot: number): Promise<void> {
  if (!ui.loaded) {
    return;
  }
  const wasPlaying = ui.playing;
  if (isTauri && ui.runtime === "tauri" && ui.nativeStates) {
    try {
      ui.playing = false;
      playToggle.textContent = "Play";
      await invoke("set_native_running", { running: false });
      const result = await invoke<LoadStateResult>("load_state_slot", { slot });
      drawNativeFrame(result.frame);
      ui.frame = result.frame.frame;
      ui.cpuCycles = result.frame.cpuCycles;
      ui.cpuSteps = result.frame.cpuSteps;
      ui.frameMs = result.frame.frameMs;
      ui.lastError = result.frame.lastError ?? "";
      ui.status = `ARGON ${slot}`;
      applyStateSlots(result.states);
      pushTrace(`Argon slot ${slot} reduced`);
      resetScheduledAudio();
      if (wasPlaying) {
        ui.playing = true;
        playToggle.textContent = "Pause";
        await invoke("set_native_running", { running: true });
        void nativeStatusLoop();
      }
      renderUi();
      return;
    } catch (error) {
      ui.playing = wasPlaying;
      playToggle.textContent = ui.playing ? "Pause" : "Play";
      if (wasPlaying) {
        await invoke("set_native_running", { running: true });
        void nativeStatusLoop();
      }
      ui.lastError = String(error);
      pushTrace("Native argon load rejected");
    }
  } else if (ui.runtime === "bridge" && ui.nativeStates) {
    try {
      ui.playing = false;
      playToggle.textContent = "Play";
      stopBridgeStream();
      const result = await bridgeJson<LoadStateResult>(`/state/load?slot=${slot}`, {
        method: "POST",
      });
      drawNativeFrame(result.frame);
      ui.frame = result.frame.frame;
      ui.cpuCycles = result.frame.cpuCycles;
      ui.cpuSteps = result.frame.cpuSteps;
      ui.frameMs = result.frame.frameMs;
      ui.lastError = result.frame.lastError ?? "";
      ui.status = `ARGON ${slot}`;
      applyStateSlots(result.states);
      pushTrace(`Argon slot ${slot} reduced`);
      resetScheduledAudio();
      await syncInput();
      if (wasPlaying) {
        ui.playing = true;
        ui.status = "RUNNING";
        playToggle.textContent = "Pause";
        if (!startBridgeVideoStream()) {
          void ensureAudio();
          void bridgeStreamLoop();
        }
      }
      renderUi();
      return;
    } catch (error) {
      ui.playing = wasPlaying;
      playToggle.textContent = ui.playing ? "Pause" : "Play";
      if (wasPlaying) {
        if (!startBridgeVideoStream()) {
          void bridgeStreamLoop();
        }
      }
      ui.lastError = String(error);
      pushTrace("Bridge argon load rejected");
    }
  }

  const snapshot = webStateSlots[slot - 1];
  if (!snapshot) {
    return;
  }
  ui.frame = snapshot.frame;
  ui.cpuCycles = snapshot.cpuCycles;
  ui.cpuSteps = snapshot.cpuSteps;
  ui.frameMs = snapshot.frameMs;
  ui.status = `ARGON ${slot}`;
  drawSyntheticFrame();
  pushTrace(`Web argon slot ${slot} restored`);
  renderUi();
}

function drawSyntheticFrame(): void {
  const width = 320;
  const height = 224;
  syncScreenGeometry(width, height);
  if (videoCanvas.width !== width || videoCanvas.height !== height) {
    videoCanvas.width = width;
    videoCanvas.height = height;
  }
  const image = videoContext.createImageData(width, height);
  const data = image.data;
  const t = ui.frame;
  const inputPulse =
    Number(inputState.a) * 31 +
    Number(inputState.b) * 57 +
    Number(inputState.c) * 83 +
    Number(inputState.start) * 127;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const wave = Math.sin((x + t * 3) * 0.045) + Math.cos((y - t * 2) * 0.065);
      const carbon = (x * 3 + y * 5 + romHash + t * 7 + inputPulse) & 255;
      const bond = Math.abs(((x - width / 2) * (y - height / 2) + t * 11) % 113) < 5;
      data[index] = bond ? 226 : 24 + ((carbon + wave * 34) & 63);
      data[index + 1] = bond ? 245 : 64 + (((carbon >> 1) + y + t) & 95);
      data[index + 2] = bond ? 172 : 50 + (((romHash >> 8) + x + inputPulse) & 79);
      data[index + 3] = 255;
    }
  }

  videoContext.putImageData(image, 0, 0);
  videoContext.fillStyle = "rgba(12, 17, 14, 0.62)";
  videoContext.fillRect(14, 14, 108, 34);
  videoContext.fillStyle = "#dff7c1";
  videoContext.font = "14px ui-monospace, SFMono-Regular, Menlo, monospace";
  videoContext.fillText(ui.loaded ? ui.timing : "C-O CORE", 24, 36);
  renderShaderFrame();
}

async function syncInput(): Promise<void> {
  const next = JSON.stringify(inputState);
  if (next === lastInputJson) {
    return;
  }
  lastInputJson = next;
  if (dogsMode) {
    void syncDogsBridgeInput(dogsInputForFrame()).catch((err) => {
      dogsSnapshotMisses += 1;
      ui.transportMode = "DOGS INPUT HOLD";
      ui.lastError = err instanceof Error ? err.message : String(err);
    });
    return;
  }
  if (activeLobbyInstance()?.kind === "eutherdoom") {
    return;
  }
  if (isTauri && ui.runtime === "tauri" && ui.loaded) {
    try {
      await invoke("set_input", { input: inputState });
    } catch {
      ui.runtime = "web";
      pushTrace("Input bridge fallback");
    }
  } else if (ui.runtime === "bridge" && ui.loaded) {
    if (lobbyRole === "spectator" || !ownsCurrentSlot()) {
      return;
    }
    if (sendBridgeWebRtcInputSnapshot()) {
      renderUi();
      return;
    }
    try {
      await bridgeRequest("/input", {
        method: "POST",
        body: JSON.stringify({ ...inputState, player: playerPort }),
      });
      ui.inputStatus = `P${playerPort} ok`;
      ui.lastError = "";
      renderUi();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ui.inputStatus = `P${playerPort} miss`;
      ui.lastError = message;
      pushTrace(`Core bridge input missed: ${message}`);
      renderUi();
    }
  }
}

function updatePadButtons(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-pad]").forEach((button) => {
    const name = button.dataset.pad as keyof InputState;
    button.classList.toggle("is-active", inputState[name]);
  });
}

function applyStateSlots(result: StateSlotsResult): void {
  ui.statePath = result.path ?? ui.statePath ?? null;
  ui.stateSlots = normalizeStateSlots(result.slots);
  ui.nativeStates = Boolean(result.path);
}

function loadWebSlots(): void {
  ui.nativeStates = false;
  ui.statePath = `${stemName(romDisplayName)}.argon`;
  try {
    const raw = window.localStorage.getItem(webStateKey());
    const parsed = raw
      ? (JSON.parse(raw) as { slots?: Array<WebStateSnapshot | null> })
      : null;
    webStateSlots = normalizeWebSlots(parsed?.slots ?? []);
  } catch {
    webStateSlots = [null, null, null];
  }
  ui.stateSlots = webSlotSummaries();
}

function persistWebSlots(): void {
  window.localStorage.setItem(
    webStateKey(),
    JSON.stringify({
      magic: "EUTHEROXIDE_WEB_ARGON",
      version: 1,
      romHash,
      slots: webStateSlots,
    }),
  );
}

async function restoreCachedRom(): Promise<void> {
  if (isTauri || ui.loaded) {
    return;
  }
  const cached = await readCachedRom();
  if (!cached) {
    return;
  }

  romBytes = cached.bytes;
  romDisplayName = cached.name;
  romHash = cached.hash || hashBytes(cached.bytes);
  Object.assign(ui, parseWebHeader(romBytes, romDisplayName));
  ui.loaded = true;
  ui.runtime = "web";
  ui.nativeStates = false;
  ui.status = "ROM CACHE";
  ui.lastError = "";
  document.querySelector("#rom-name")!.textContent = romDisplayName;
  loadWebSlots();
  drawSyntheticFrame();
  pushTrace("Browser ROM cache restored");
  renderUi();

  if (!(await loadBytesThroughBridge(romDisplayName, romBytes))) {
    scheduleBridgeRetry();
  }
}

async function persistCachedRom(name: string, bytes: Uint8Array): Promise<void> {
  if (isTauri || !window.indexedDB) {
    return;
  }
  await withRomStore<IDBValidKey>("readwrite", (store) =>
    store.put({
      key: "last",
      name,
      bytes: copyArrayBuffer(bytes),
      hash: hashBytes(bytes),
      savedUnixMs: Date.now(),
    } satisfies CachedRomRecord),
  ).catch(() => undefined);
}

async function readCachedRom(): Promise<{
  name: string;
  bytes: Uint8Array<ArrayBuffer>;
  hash: number;
} | null> {
  if (!window.indexedDB) {
    return null;
  }
  const record = await withRomStore<CachedRomRecord | undefined>("readonly", (store) =>
    store.get("last") as IDBRequest<CachedRomRecord | undefined>,
  ).catch(() => undefined);
  if (!record?.bytes || typeof record.name !== "string") {
    return null;
  }
  const bytes = new Uint8Array(record.bytes.slice(0)) as Uint8Array<ArrayBuffer>;
  if (bytes.length === 0) {
    return null;
  }
  return {
    name: record.name,
    bytes,
    hash: record.hash >>> 0,
  };
}

function copyArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function openRomCacheDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(romCacheDb, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(romCacheStore)) {
        db.createObjectStore(romCacheStore, { keyPath: "key" });
      }
    };
    request.onerror = () => reject(request.error ?? new Error("Could not open ROM cache"));
    request.onsuccess = () => resolve(request.result);
  });
}

async function withRomStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openRomCacheDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(romCacheStore, mode);
    const request = action(transaction.objectStore(romCacheStore));
    let result: T;
    request.onsuccess = () => {
      result = request.result;
    };
    const fail = () => {
      db.close();
      reject(transaction.error ?? request.error ?? new Error("ROM cache request failed"));
    };
    transaction.onerror = fail;
    transaction.onabort = fail;
    transaction.oncomplete = () => {
      db.close();
      resolve(result);
    };
  });
}

function webSlotSummaries(): StateSlot[] {
  return webStateSlots.map((slot, index) => ({
    slot: index + 1,
    occupied: Boolean(slot),
    createdUnixMs: slot ? Date.now() : null,
    frameCount: slot?.frame ?? null,
    label: slot ? `Frame ${slot.frame}` : null,
  }));
}

function normalizeWebSlots(slots: Array<WebStateSnapshot | null>): Array<WebStateSnapshot | null> {
  return Array.from({ length: 3 }, (_, index) => slots[index] ?? null);
}

function emptySlots(): StateSlot[] {
  return Array.from({ length: 3 }, (_, index) => ({
    slot: index + 1,
    occupied: false,
    createdUnixMs: null,
    frameCount: null,
    label: null,
  }));
}

function normalizeStateSlots(slots: StateSlot[]): StateSlot[] {
  const bySlot = new Map(slots.map((slot) => [slot.slot, slot]));
  return emptySlots().map((slot) => bySlot.get(slot.slot) ?? slot);
}

function renderStateSlots(): void {
  const bySlot = new Map(ui.stateSlots.map((slot) => [slot.slot, slot]));
  stateGrid.querySelectorAll<HTMLElement>("[data-slot-row]").forEach((row) => {
    const slotNumber = Number(row.dataset.slotRow ?? 0);
    const slot = bySlot.get(slotNumber);
    const label = row.querySelector("strong")!;
    const save = row.querySelector<HTMLButtonElement>('[data-state-action="save"]')!;
    const load = row.querySelector<HTMLButtonElement>('[data-state-action="load"]')!;
    label.textContent = slot?.occupied ? slot.label ?? `Frame ${slot.frameCount ?? "?"}` : "Empty";
    save.disabled = !ui.loaded || !canHostMutate();
    load.disabled = !ui.loaded || !Boolean(slot?.occupied) || !canHostMutate();
  });
}

function renderUi(): void {
  document.querySelector("#game-title")!.textContent = appRoute === "playHome" ? "Reaction Lobby" : ui.title;
  document.querySelector("#status-text")!.textContent = ui.status;
  document.querySelector("#frame-count")!.textContent = String(ui.frame);
  document.querySelector("#timing-mode")!.textContent = ui.timing;
  document.querySelector("#region-mode")!.textContent = ui.region;
  document.querySelector("#reset-pc")!.textContent = `$${ui.resetPc.toString(16).padStart(6, "0").toUpperCase()}`;
  document.querySelector("#cycle-count")!.textContent = String(ui.cpuCycles);
  document.querySelector("#step-count")!.textContent = String(ui.cpuSteps);
  document.querySelector("#frame-ms")!.textContent = ui.frameMs.toFixed(2);
  document.querySelector("#bridge-mode")!.textContent = ui.runtime.toUpperCase();
  document.querySelector("#fetch-ms")!.textContent = ui.transportMs.toFixed(2);
  document.querySelector("#draw-ms")!.textContent = ui.drawMs.toFixed(2);
  document.querySelector("#audio-lead-ms")!.textContent = ui.audioLeadMs.toFixed(0);
  document.querySelector("#transport-mode")!.textContent = ui.transportMode;
  document.querySelector("#rtc-lease-status")!.textContent = ui.rtcLeaseStatus;
  document.querySelector("#input-status")!.textContent = ui.inputStatus;
  document.querySelector("#video-age-status")!.textContent = ui.videoAgeStatus;
  document.querySelector("#build-id")!.textContent = WEB_BUILD_ID;
  perfSummary.textContent = `${ui.frameMs.toFixed(2)} ms | ${ui.audioLeadMs.toFixed(0)} lead`;
  document.querySelector("#runtime-chip")!.textContent =
    ui.runtime === "tauri"
      ? "TAURI 2 CORE"
      : ui.runtime === "bridge"
        ? "CORE BRIDGE"
        : "WEB VIEW";
  playToggle.disabled = !ui.loaded;
  stepFrame.disabled = !ui.loaded;
  resetCore.disabled = !ui.loaded || !canHostMutate();
  mobilePlay.disabled = !ui.loaded;
  mobilePlay.textContent = ui.playing ? "Pause" : "Play";
  screenGlass.classList.toggle("is-native-frame", ui.loaded && ui.runtime !== "web");
  renderPlayerPort();
  renderLobby();
  renderBuildControls();
  renderStateSlots();
  scheduleNativeSurfaceRectSync();
}

function renderBuildControls(): void {
  const bridgeOnline = ui.runtime === "bridge" && !isTauri;
  releaseBuild.disabled = !bridgeOnline || ui.build.building;
  releaseBuild.textContent = ui.build.building ? "Building" : "Build";
  const selectedProfile =
    desiredBuildProfile === "release" || ui.build.activeProfile === "release"
      ? "release"
      : "debug";
  buildProfileButtons.forEach((button) => {
    const profile = button.dataset.buildProfile === "release" ? "release" : "debug";
    button.classList.toggle("is-selected", profile === selectedProfile);
    button.disabled = !bridgeOnline || ui.build.building;
  });
  buildLamp.className = "build-lamp";
  buildLamp.classList.add(ui.build.armed ? "is-armed" : "is-cold");
  if (ui.build.building) {
    buildLamp.classList.add("is-building");
  }
  buildLamp.title = ui.build.armed
    ? "Release binary ready and armed"
    : ui.build.building
      ? "Release build running"
      : ui.build.releaseReady
        ? "Release binary ready"
        : "Release binary not ready";
}

function scheduleNativeSurfaceRectSync(): void {
  if (!isTauri) {
    return;
  }
  if (nativeSurfaceRectTimer !== null) {
    window.clearTimeout(nativeSurfaceRectTimer);
  }
  nativeSurfaceRectTimer = window.setTimeout(() => {
    nativeSurfaceRectTimer = null;
    void syncNativeSurfaceRect();
  }, 0);
}

async function syncNativeSurfaceRect(): Promise<void> {
  if (!isTauri) {
    return;
  }
  const rect = screenGlass.getBoundingClientRect();
  try {
    await invoke("set_native_surface_rect", {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    });
  } catch {
    // The native surface is Linux/Tauri specific and may not be present in all dev modes.
  }
}

function pushTrace(message: string): void {
  const list = document.querySelector<HTMLOListElement>("#trace-list")!;
  const entry = document.createElement("li");
  entry.textContent = message;
  list.prepend(entry);
  while (list.children.length > 6) {
    list.lastElementChild?.remove();
  }
}

function parseWebHeader(bytes: Uint8Array, fallbackName: string): LoadResult {
  const headerOffset =
    ascii(bytes, 0x100, 4) === "SEGA" ? 0x100 : ascii(bytes, 0x300, 4) === "SEGA" ? 0x300 : -1;
  const regionText = headerOffset >= 0 ? ascii(bytes, headerOffset + 0xf0, 16).toUpperCase() : "";
  const title = headerOffset >= 0 ? ascii(bytes, headerOffset + 0x50, 48).trim() : "";
  const hasEurope = regionText.includes("E") || /^[89A-F]/.test(regionText);
  const hasUs = regionText.includes("U") || /^[4567CDEF]/.test(regionText);
  const hasJapan = regionText.includes("J") || /^[1237BDF]/.test(regionText);
  return {
    title: title || fallbackName,
    region: hasUs ? "US" : hasEurope ? "EU" : hasJapan ? "JP" : "AUTO",
    timing: hasEurope ? "PAL" : "NTSC",
    resetPc: readU32(bytes, 4),
    width: 320,
    height: 224,
  };
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let out = "";
  for (let index = 0; index < length; index += 1) {
    const byte = bytes[offset + index] ?? 32;
    out += byte >= 32 && byte < 127 ? String.fromCharCode(byte) : " ";
  }
  return out;
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) << 24) |
    ((bytes[offset + 1] ?? 0) << 16) |
    ((bytes[offset + 2] ?? 0) << 8) |
    (bytes[offset + 3] ?? 0)
  ) >>> 0;
}

function tauriFilePath(file: File): string | null {
  const withPath = file as File & { path?: unknown };
  return typeof withPath.path === "string" ? withPath.path : null;
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function stemName(name: string): string {
  const base = basename(name);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

function webStateKey(): string {
  return `eutheroxide.argon.${romHash.toString(16)}`;
}

function hashBytes(bytes: Uint8Array): number {
  let hash = 2166136261;
  const stride = Math.max(1, Math.floor(bytes.length / 4096));
  for (let index = 0; index < bytes.length; index += stride) {
    hash ^= bytes[index];
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function hashText(value: string): number {
  return hashBytes(new TextEncoder().encode(value));
}

function startMoleculeField(): void {
  const canvas = document.querySelector<HTMLCanvasElement>("#molecule-field")!;
  const context = canvas.getContext("2d")!;
  const atoms = Array.from({ length: 86 }, (_, index) => ({
    x: Math.random(),
    y: Math.random(),
    r: 2 + (index % 6),
    phase: Math.random() * Math.PI * 2,
    kind: index % 7 === 0 ? "O" : index % 11 === 0 ? "H" : "C",
  }));

  const resize = () => {
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(window.innerWidth * ratio);
    canvas.height = Math.floor(window.innerHeight * ratio);
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    scheduleNativeSurfaceRectSync();
  };
  window.addEventListener("resize", resize);
  resize();

  const draw = (time: number) => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const protectedRect = screenGlass.getBoundingClientRect();
    const guard = {
      left: protectedRect.left - 18,
      right: protectedRect.right + 18,
      top: protectedRect.top - 18,
      bottom: protectedRect.bottom + 18,
    };
    const inGuard = (x: number, y: number) =>
      x >= guard.left && x <= guard.right && y >= guard.top && y <= guard.bottom;

    context.clearRect(0, 0, width, height);
    context.save();
    context.globalCompositeOperation = "screen";
    context.lineWidth = 1.4;

    const waveY = height * 0.54 + Math.sin(time * 0.00022) * 18;
    context.strokeStyle = "rgba(245, 215, 125, 0.12)";
    context.beginPath();
    context.moveTo(0, waveY);
    for (let x = 0; x <= width; x += 44) {
      const y = waveY + Math.sin(x * 0.018 + time * 0.00058) * 34;
      context.lineTo(x, y);
    }
    context.stroke();

    context.font = "700 15px ui-monospace, SFMono-Regular, Menlo, monospace";
    context.fillStyle = "rgba(223, 246, 180, 0.13)";
    for (let index = 0; index < 9; index += 1) {
      const x = (index * 211 + time * 0.012) % (width + 180) - 90;
      const y = 72 + ((index * 83) % Math.max(1, height - 140));
      if (!inGuard(x, y)) {
        context.fillText(index % 3 === 0 ? "C=C" : index % 3 === 1 ? "O2" : "R-CHO", x, y);
      }
    }

    for (let i = 0; i < atoms.length; i += 1) {
      const atom = atoms[i];
      const x = atom.x * width + Math.sin(time * 0.00018 + atom.phase) * 24;
      const y = atom.y * height + Math.cos(time * 0.00021 + atom.phase) * 18;
      if (inGuard(x, y)) {
        continue;
      }
      for (let j = i + 1; j < atoms.length; j += 1) {
        const other = atoms[j];
        const ox = other.x * width + Math.sin(time * 0.00018 + other.phase) * 24;
        const oy = other.y * height + Math.cos(time * 0.00021 + other.phase) * 18;
        if (inGuard(ox, oy)) {
          continue;
        }
        const dx = x - ox;
        const dy = y - oy;
        const distance = Math.hypot(dx, dy);
        if (distance < 170) {
          context.strokeStyle = `rgba(168, 229, 139, ${0.16 * (1 - distance / 170)})`;
          context.beginPath();
          context.moveTo(x, y);
          context.lineTo(ox, oy);
          context.stroke();
        }
      }
      context.fillStyle =
        atom.kind === "O" ? "rgba(255, 95, 82, 0.38)" : atom.kind === "H" ? "rgba(240, 229, 154, 0.26)" : "rgba(161, 220, 168, 0.31)";
      context.beginPath();
      context.arc(x, y, atom.r, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();

    window.requestAnimationFrame(draw);
  };

  window.requestAnimationFrame(draw);
}

shaderRenderer = ShaderRenderer.create(shaderCanvas);
screenGlass.classList.toggle("has-shader", Boolean(shaderRenderer));
drawSyntheticFrame();
renderUi();
startMoleculeField();
void (async () => {
  if (autoStartEutherDogs) {
    await refreshAuthStatus();
    await ensureHostedLobbyInstance();
  }
  await connectBridge();
  if (autoStartEutherDogs && !ui.loaded) {
    await enterDogsMode();
  } else if (!autoStartEutherDogs) {
    await restoreCachedRom();
  }
})();
