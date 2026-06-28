import Link from 'next/link';
import styles from './not-found.module.css';

export default function NotFound() {
  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.errorCode}>404</div>
        <h1 className={styles.heading}>Route Not Found</h1>
        <p className={styles.text}>
          The page you are looking for doesn&apos;t exist or has been archived.
        </p>
        <Link href="/" className={styles.button}>
          Return to Dashboard
        </Link>
      </div>
    </div>
  );
}
