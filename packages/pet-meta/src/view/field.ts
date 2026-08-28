/**
 * 값 하나와 그 값의 조회 실패를 함께 담는다.
 *
 * 기획서 5.4·INFO-007은 "다른 도메인 조회 오류는 해당 블록만 오류 처리하고 나머지 정보를
 * 유지한다"고 정한다. 화면 전체를 하나의 `try`로 감싸면 `battle` 도메인 조회가 실패한
 * 순간 사용량 수치까지 사라진다. 그래서 각 값이 자기 오류를 들고 다닌다.
 *
 * 포트는 실패를 던지고, 이 계층이 블록마다 잡아 여기에 담는다. 던지는 것이 TypeScript의
 * 관용이고, 잡는 위치를 화면 블록 경계에 두는 것이 기획서의 요구다.
 */
export interface Field<T> {
  value: T | undefined;
  error: string | undefined;
}

export const okField = <T>(value: T): Field<T> => ({ value, error: undefined });

export const failedField = <T>(message: string): Field<T> => ({
  value: undefined,
  error: message,
});

/** 포트 호출을 감싸 블록별 오류로 바꾼다. */
export function fieldOf<T>(read: () => T): Field<T> {
  try {
    return okField(read());
  } catch (error) {
    return failedField(error instanceof Error ? error.message : String(error));
  }
}

export function mapField<T, U>(field: Field<T>, transform: (value: T) => U): Field<U> {
  return field.value === undefined
    ? { value: undefined, error: field.error }
    : { value: transform(field.value), error: field.error };
}
