/**
 * basic-pitch가 쓰는 텐서플로를 필요한 부분만 묶는다 (vite.config의 별칭이 "@tensorflow/tfjs"를 이 파일로 바꾼다).
 * 전체 tfjs(학습용 layers·data 포함) 대신 계산(core)·모델 읽기(converter)·WebGL과 CPU 백엔드만 넣는다.
 * 받아 적기를 처음 쓸 때만 내려받는다 (실험실)
 */
export * from "@tensorflow/tfjs-core";
// basic-pitch는 tensor.slice()처럼 텐서에 붙은 연산을 쓴다 (전체 tfjs가 등록해 주던 것)
import "@tensorflow/tfjs-core/dist/public/chained_ops/register_all_chained_ops";
export * from "@tensorflow/tfjs-converter";
import "@tensorflow/tfjs-backend-webgl";
import "@tensorflow/tfjs-backend-cpu";
