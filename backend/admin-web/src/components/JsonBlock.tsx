interface JsonBlockProps {
  value: unknown;
}

export function JsonBlock({ value }: JsonBlockProps): JSX.Element {
  return (
    <pre className="json-block">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
