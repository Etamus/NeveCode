// @ts-nocheck
import { spawn } from 'node:child_process'
import {
  resolveCodexApiCredentials,
} from '../src/services/api/providerConfig.js'
import {
  normalizeRecommendationGoal,
  recommendOllamaModel,
} from '../src/utils/providerRecommendation.ts'
import {
  buildLaunchEnv,
  loadProfileFile,
  selectAutoProfile,
  type ProfileFile,
  type ProviderProfile,
} from '../src/utils/providerProfile.ts'
import {
  getAtomicChatChatBaseUrl,
  getLlamaCppChatBaseUrl,
  getOllamaChatBaseUrl,
  hasLocalAtomicChat,
  hasLocalLlamaCpp,
  hasLocalOllama,
  listAtomicChatModels,
  listLlamaCppModels,
  listOllamaModels,
} from './provider-discovery.ts'

type LaunchOptions = {
  requestedProfile: ProviderProfile | 'auto' | null
  passthroughArgs: string[]
  fast: boolean
  goal: ReturnType<typeof normalizeRecommendationGoal>
}

function parseLaunchOptions(argv: string[]): LaunchOptions {
  let requestedProfile: ProviderProfile | 'auto' | null = 'auto'
  const passthroughArgs: string[] = []
  let fast = false
  let goal = normalizeRecommendationGoal(process.env.NEVECODE_PROFILE_GOAL)

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    const lower = arg.toLowerCase()
    if (lower === '--fast') {
      fast = true
      continue
    }

    if (lower === '--goal') {
      goal = normalizeRecommendationGoal(argv[i + 1] ?? null)
      i++
      continue
    }

    if ((lower === 'auto' || lower === 'openai' || lower === 'ollama' || lower === 'codex' || lower === 'gemini' || lower ==='mistral' || lower === 'atomic-chat' || lower === 'llamacpp') && requestedProfile === 'auto') {
      requestedProfile = lower as ProviderProfile | 'auto'
      continue
    }

    if (arg.startsWith('--')) {
      passthroughArgs.push(arg)
      continue
    }

    if (requestedProfile === 'auto') {
      requestedProfile = null
      break
    }

    passthroughArgs.push(arg)
  }

  return {
    requestedProfile,
    passthroughArgs,
    fast,
    goal,
  }
}

function loadPersistedProfile(): ProfileFile | null {
  return loadProfileFile()
}

async function resolveLlamaCppDefaultModel(): Promise<string | null> {
  const models = await listLlamaCppModels()
  return models[0] ?? null
}

async function resolveOllamaDefaultModel(
  goal: ReturnType<typeof normalizeRecommendationGoal>,
): Promise<string | null> {
  const models = await listOllamaModels()
  const recommended = recommendOllamaModel(models, goal)
  return recommended?.name ?? null
}

async function resolveAtomicChatDefaultModel(): Promise<string | null> {
  const models = await listAtomicChatModels()
  return models[0] ?? null
}

function runCommand(command: string, env: NodeJS.ProcessEnv): Promise<number> {
  return runProcess(command, [], env)
}

function runProcess(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise(resolve => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      stdio: 'inherit',
    })

    child.on('close', code => resolve(code ?? 1))
    child.on('error', () => resolve(1))
  })
}

function applyFastFlags(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  env.CLAUDE_CODE_SIMPLE ??= '1'
  env.CLAUDE_CODE_DISABLE_THINKING ??= '1'
  env.DISABLE_INTERLEAVED_THINKING ??= '1'
  env.DISABLE_AUTO_COMPACT ??= '1'
  env.CLAUDE_CODE_DISABLE_AUTO_MEMORY ??= '1'
  env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS ??= '1'
  return env
}

function printSummary(profile: ProviderProfile): void {
  console.log(`Launching profile: ${profile}`)
  if (profile === 'llamacpp') {
    console.log('Using llama.cpp (llama-server) at http://localhost:8080/v1')
  } else if (profile === 'gemini') {
    console.log('Using configured Gemini provider settings.')
  } else if (profile === 'mistral') {
    console.log('Using configured Mistral provider settings.')
  } else if (profile === 'codex') {
    console.log('Using configured Codex/OpenAI-compatible provider settings.')
  } else if (profile === 'atomic-chat') {
    console.log('Using configured Atomic Chat provider settings.')
  } else if (profile === 'ollama') {
    console.log('Using configured Ollama provider settings.')
  } else {
    console.log('Using configured OpenAI-compatible provider settings.')
  }
}

async function main(): Promise<void> {
  const options = parseLaunchOptions(process.argv.slice(2))
  const requestedProfile = options.requestedProfile
  if (!requestedProfile) {
    console.error('Usage: bun run scripts/provider-launch.ts [llamacpp|openai|ollama|codex|gemini|mistral|atomic-chat|auto] [--fast] [--goal <latency|balanced|coding>] [-- <cli args>]')
    process.exit(1)
  }

  const persisted = loadPersistedProfile()
  let profile: ProviderProfile
  let resolvedLlamaCppModel: string | null = null
  let resolvedOllamaModel: string | null = null

  if (requestedProfile === 'auto') {
    if (persisted) {
      profile = persisted.profile
    } else if (await hasLocalLlamaCpp()) {
      // Prefer llama.cpp if llama-server is already running
      resolvedLlamaCppModel = await resolveLlamaCppDefaultModel()
      profile = 'llamacpp'
    } else if (await hasLocalOllama()) {
      resolvedOllamaModel = await resolveOllamaDefaultModel(options.goal)
      profile = selectAutoProfile(resolvedOllamaModel)
    } else {
      profile = 'openai'
    }
  } else {
    profile = requestedProfile
  }

  if (
    profile === 'ollama' &&
    (persisted?.profile !== 'ollama' || !persisted?.env?.OPENAI_MODEL)
  ) {
    resolvedOllamaModel ??= await resolveOllamaDefaultModel(options.goal)
    if (!resolvedOllamaModel) {
      console.error('No viable Ollama chat model was discovered. Pull a chat model first or save one with `bun run profile:init -- --provider ollama --model <model>`.')
      process.exit(1)
    }
  }

  if (profile === 'llamacpp' && !resolvedLlamaCppModel && (!persisted?.env?.OPENAI_MODEL)) {
    if (!(await hasLocalLlamaCpp())) {
      console.error(
        'llama-server is not running (could not reach http://localhost:8080).\n' +
        '  Make sure to run start.bat to launch llama-server first.\n' +
        '  Or place a .gguf model in the models/ directory and run start.bat.'
      )
      process.exit(1)
    }
    resolvedLlamaCppModel = await resolveLlamaCppDefaultModel()
  }

  let resolvedAtomicChatModel: string | null = null
  if (
    profile === 'atomic-chat' &&
    (persisted?.profile !== 'atomic-chat' || !persisted?.env?.OPENAI_MODEL)
  ) {
    if (!(await hasLocalAtomicChat())) {
      console.error('Atomic Chat is not running (could not connect to 127.0.0.1:1337).\n  Download from https://atomic.chat/ and launch the application.')
      process.exit(1)
    }
    resolvedAtomicChatModel = await resolveAtomicChatDefaultModel()
    if (!resolvedAtomicChatModel) {
      console.error('Atomic Chat is running but no model is loaded. Open Atomic Chat and download or start a model first.')
      process.exit(1)
    }
  }

  const env = await buildLaunchEnv({
    profile,
    persisted,
    goal: options.goal,
    getOllamaChatBaseUrl,
    resolveOllamaDefaultModel: async () => resolvedOllamaModel || 'llama3.1:8b',
    getAtomicChatChatBaseUrl,
    resolveAtomicChatDefaultModel: async () => resolvedAtomicChatModel,
    getLlamaCppChatBaseUrl,
  })

  // For llamacpp, ensure the model is set if discovered
  if (profile === 'llamacpp' && resolvedLlamaCppModel) {
    env.OPENAI_MODEL = resolvedLlamaCppModel
  }

  if (options.fast) {
    applyFastFlags(env)
  }

  if (profile === 'gemini' && !env.GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY is required for gemini profile. Run: bun run profile:init -- --provider gemini --api-key <key>')
    process.exit(1)
  }

  if (profile === 'mistral' && !env.MISTRAL_API_KEY) {
    console.error('MISTRAL_API_KEY is required for mistral profile. Run: bun run profile:init -- --provider mistral --api-key <key>')
    process.exit(1)
  }

  if (profile === 'openai' && (!env.OPENAI_API_KEY || env.OPENAI_API_KEY === 'SUA_CHAVE')) {
    console.error('OPENAI_API_KEY is required for openai profile and cannot be SUA_CHAVE. Run: bun run profile:init -- --provider openai --api-key <key>')
    process.exit(1)
  }

  if (profile === 'codex') {
    const credentials = resolveCodexApiCredentials(env)
    if (!credentials.apiKey) {
      const authHint = credentials.authPath
        ? ` or make sure ${credentials.authPath} exists`
        : ''
      console.error(`CODEX_API_KEY is required for codex profile${authHint}. Run: bun run profile:init -- --provider codex --model codexplan`)
      process.exit(1)
    }

    if (!credentials.accountId) {
      console.error('CHATGPT_ACCOUNT_ID is required for codex profile. Set CHATGPT_ACCOUNT_ID/CODEX_ACCOUNT_ID or use an auth.json that includes it.')
      process.exit(1)
    }
  }

  printSummary(profile)

  const doctorCode = await runProcess('bun', ['run', 'scripts/system-check.ts'], env)
  if (doctorCode !== 0) {
    console.error('Runtime doctor failed. Fix configuration before launching.')
    process.exit(doctorCode)
  }

  const buildCode = await runProcess('bun', ['run', 'build'], env)
  if (buildCode !== 0) {
    process.exit(buildCode)
  }

  const devCode = await runProcess('node', ['dist/cli.mjs', ...options.passthroughArgs], env)
  process.exit(devCode)
}

await main()

export {}
