<template>
  <section class="left-hero-pane" :class="{ 'is-preview': isPreview }">
    <!-- Brand & Seal -->
    <div class="brand-mark-row">
      <div class="brand-seal-icon">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
        </svg>
      </div>
      <div class="brand-title-wrap">
        <span class="brand-title-text arc-serif-title">{{ title }}</span>
        <el-input
          v-if="editing === 'subtitle'"
          ref="editInput"
          v-model="draft"
          size="small"
          :maxlength="80"
          @blur="commit"
          @keyup.enter="commit"
        />
        <span
          v-else
          class="brand-sub-badge"
          :class="{ 'is-editable': editable }"
          @click="beginEdit('subtitle')"
        >{{ copy.subtitle || defaults.subtitle }}</span>
      </div>
    </div>

    <!-- Slogan -->
    <div class="hero-statement">
      <el-input
        v-if="editing === 'slogan'"
        ref="editInput"
        v-model="draft"
        type="textarea"
        :rows="2"
        :maxlength="160"
        @blur="commit"
      />
      <h1
        v-else
        class="hero-slogan-large arc-serif-title"
        :class="{ 'is-editable': editable }"
        @click="beginEdit('slogan')"
      >
        <template v-for="(line, index) in sloganLines" :key="`${index}-${line}`">
          <span :class="{ 'ink-highlight': index === sloganLines.length - 1 }">{{ line }}</span>
          <br v-if="index < sloganLines.length - 1" />
        </template>
      </h1>

      <!-- Literary Letter Quote Box -->
      <div class="hero-letter-quote">
        <el-input
          v-if="editing === 'quoteLead'"
          ref="editInput"
          v-model="draft"
          size="small"
          :maxlength="160"
          @blur="commit"
          @keyup.enter="commit"
        />
        <div
          v-else
          class="quote-poem-lead arc-serif-title"
          :class="{ 'is-editable': editable }"
          @click="beginEdit('quoteLead')"
        >{{ copy.quoteLead || defaults.quoteLead }}</div>

        <el-input
          v-if="editing === 'quoteBody'"
          ref="editInput"
          v-model="draft"
          type="textarea"
          :rows="3"
          :maxlength="500"
          @blur="commit"
        />
        <p
          v-else
          class="quote-body-text"
          :class="{ 'is-editable': editable }"
          @click="beginEdit('quoteBody')"
        >
          <span>{{ copy.quoteBody || defaults.quoteBody }}</span>
        </p>

        <div class="hero-quote-footer">
          <div class="footer-left-author">
            <el-input
              v-if="editing === 'sealText'"
              ref="editInput"
              v-model="draft"
              size="small"
              :maxlength="16"
              style="width: 120px"
              @blur="commit"
              @keyup.enter="commit"
            />
            <span
              v-else
              class="author-seal-tag"
              :class="{ 'is-editable': editable }"
              @click="beginEdit('sealText')"
            >{{ copy.sealText || defaults.sealText }}</span>

            <el-input
              v-if="editing === 'footerText'"
              ref="editInput"
              v-model="draft"
              size="small"
              :maxlength="80"
              style="width: 160px"
              @blur="commit"
              @keyup.enter="commit"
            />
            <span
              v-else
              :class="{ 'is-editable': editable }"
              @click="beginEdit('footerText')"
            >{{ copy.footerText || defaults.footerText }}</span>
          </div>

          <el-input
            v-if="editing === 'stampText'"
            ref="editInput"
            v-model="draft"
            size="small"
            :maxlength="80"
            style="width: 120px"
            @blur="commit"
            @keyup.enter="commit"
          />
          <div
            v-else
            class="season-stamp"
            :class="{ 'is-editable': editable }"
            @click="beginEdit('stampText')"
          >{{ copy.stampText || defaults.stampText }}</div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, nextTick, ref } from 'vue'
import { defaultLoginCopy } from '@/utils/brand.js'

const props = defineProps({
  title: { type: String, default: '' },
  copy: { type: Object, required: true },
  editable: { type: Boolean, default: false },
  isPreview: { type: Boolean, default: false }
})

const emit = defineEmits(['update:copy'])

// Reactive so the fallback copy follows a language switch without a reload.
const defaults = computed(() => defaultLoginCopy())
const editing = ref('')
const draft = ref('')
const editInput = ref()

const sloganLines = computed(() => String(props.copy.slogan || defaults.value.slogan).split('\n'))

function beginEdit(key) {
  if (!props.editable || editing.value) return
  draft.value = props.copy[key] ?? ''
  editing.value = key
  nextTick(() => {
    const input = editInput.value
    if (!input) return
    input.focus?.()
    input.select?.()
  })
}

function commit() {
  const key = editing.value
  if (!key) return
  editing.value = ''
  const next = draft.value
  if ((props.copy[key] ?? '') === next) return
  emit('update:copy', { ...props.copy, [key]: next })
}
</script>

<style lang="scss" scoped>
/* Left Hero Pane */
.left-hero-pane {
  display: flex;
  flex-direction: column;
  gap: 36px;
  padding: 20px 0;

  @media (max-width: 960px) {
    display: none;
  }

  &.is-preview {
    @media (max-width: 960px) {
      display: flex;
    }
  }

  .brand-mark-row {
    display: flex;
    align-items: center;
    gap: 14px;

    .brand-seal-icon {
      width: 46px;
      height: 46px;
      background: var(--accent);
      color: #ffffff;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      box-shadow: 0 8px 20px -4px color-mix(in srgb, var(--accent) 35%, transparent);

      svg {
        width: 26px;
        height: 26px;
      }
    }

    .brand-title-wrap {
      display: flex;
      flex-direction: column;
      min-width: 0;

      .brand-title-text {
        font-size: 22px;
        font-weight: 700;
        letter-spacing: 0.05em;
        color: var(--text-strong);
      }

      .brand-sub-badge {
        font-size: 11.5px;
        color: var(--muted);
        letter-spacing: 0.08em;
      }
    }
  }

  .hero-statement {
    display: flex;
    flex-direction: column;
    gap: 28px;

    .hero-slogan-large {
      font-size: clamp(32px, 3.6vw, 42px);
      font-weight: 700;
      line-height: 1.25;
      letter-spacing: 0.02em;
      color: var(--text-strong);
      margin: 0;

      .ink-highlight {
        color: var(--accent);
      }
    }

    .hero-letter-quote {
      background: var(--surface);
      border: 1px solid var(--line);
      border-left: 4px solid var(--accent);
      border-radius: 0 14px 14px 0;
      padding: 24px 28px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.03);
      display: flex;
      flex-direction: column;
      gap: 14px;

      .quote-poem-lead {
        font-size: 16px;
        font-weight: 600;
        color: var(--text-strong);
        letter-spacing: 0.03em;
      }

      .quote-body-text {
        font-size: 13.5px;
        color: var(--muted);
        line-height: 1.7;
        margin: 0;
      }

      .hero-quote-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding-top: 10px;
        border-top: 1px dashed var(--line);
        font-size: 12px;
        color: var(--faint);

        .footer-left-author {
          display: flex;
          align-items: center;
          gap: 6px;

          .author-seal-tag {
            background: color-mix(in srgb, var(--accent) 12%, transparent);
            color: var(--accent);
            padding: 1px 6px;
            border-radius: 4px;
            font-weight: 600;
          }
        }
      }
    }
  }
}

/* 可编辑态：hover 提示可点 */
.is-editable {
  cursor: text;
  border-radius: 6px;
  outline: 1px dashed transparent;
  transition: background 0.15s ease, outline-color 0.15s ease;

  &:hover {
    background: color-mix(in srgb, var(--accent) 8%, transparent);
    outline-color: color-mix(in srgb, var(--accent) 40%, transparent);
  }
}
</style>
