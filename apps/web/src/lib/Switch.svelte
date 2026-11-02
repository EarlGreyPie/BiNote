<script lang="ts">
  /** 켜기·끄기 스위치. 속은 보통 체크칸이라 키보드(Space)와 화면 읽기가 그대로 된다 */
  interface Props {
    id?: string;
    checked: boolean;
    disabled?: boolean;
    /** 이름표(label for)가 없을 때 쓰는 이름 */
    label?: string;
    onchange: (on: boolean) => void;
  }
  let { id, checked, disabled = false, label, onchange }: Props = $props();
</script>

<span class="switch" class:disabled>
  <input {id} type="checkbox" role="switch" {checked} {disabled} aria-label={label} onchange={(e) => onchange(e.currentTarget.checked)} />
  <i aria-hidden="true"></i>
</span>

<style>
  .switch {
    position: relative;
    display: inline-flex;
    flex: none;
  }
  input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }
  i {
    width: 38px;
    height: 22px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--muted) 45%, var(--line));
    position: relative;
    transition: background 0.15s;
    /* 그림 위를 눌러도 밑의 체크칸이 받는다 */
    pointer-events: none;
  }
  i::after {
    content: "";
    position: absolute;
    top: 3px;
    left: 3px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.25);
    transition: transform 0.15s;
  }
  input:checked + i {
    background: var(--accent);
  }
  input:checked + i::after {
    transform: translateX(16px);
  }
  input:focus-visible + i {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .disabled {
    opacity: 0.5;
  }
  .disabled input {
    cursor: default;
  }
  @media (prefers-reduced-motion: reduce) {
    i,
    i::after {
      transition: none;
    }
  }
</style>
