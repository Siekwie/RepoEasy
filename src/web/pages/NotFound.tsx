import { Link } from 'react-router-dom';
import { useTitle } from '../lib/hooks.ts';
import { Empty } from '../components/ui.tsx';

export function NotFound() {
  useTitle('Not found');
  return (
    <Empty
      title="That page doesn't exist"
      action={
        <Link className="btn btn-primary" to="/">
          Back to overview
        </Link>
      }
    >
      Check the address, or head back to your overview.
    </Empty>
  );
}
