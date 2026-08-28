import type { CourseEnrollmentData } from './api';

export interface PrefetchedData {
  timestamp: number;
  courses: {
    [courseId: string]: CourseEnrollmentData;
  };
}

async function fetchCourseDataFromApi(courseName: string): Promise<CourseEnrollmentData> {
  const url = `/api/course-data?course=${encodeURIComponent(courseName)}`;
  console.log(`[prefetch] Attempting to fetch: ${url}`);
  try {
    const response = await fetch(url);
    console.log(`[prefetch] Response status: ${response.status} for ${courseName}`);
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[prefetch] Error response body:`, errorText);
      throw new Error(`Failed to fetch course data: ${response.statusText}`);
    }
    const data = await response.json();
    console.log(`[prefetch] Successfully fetched data for ${courseName}:`, data);
    return data;
  } catch (error) {
    console.error(`[prefetch] Fetch error for ${courseName}:`, error);
    throw error;
  }
}

export async function prefetchAllCourseData(
  courses: { id: string }[],
  onProgress: (progress: number) => void
): Promise<PrefetchedData> {
  console.log(`[prefetchAllCourseData] Starting prefetch for ${courses.length} courses`);
  const prefetchedData: PrefetchedData = {
    timestamp: Date.now(),
    courses: {}
  };

  let completed = 0;

  // Process courses sequentially to avoid overwhelming the API
  for (const course of courses) {
    console.log(`[prefetchAllCourseData] Fetching ${course.id} (${completed + 1}/${courses.length})`);
    try {
      const data = await fetchCourseDataFromApi(course.id);
      prefetchedData.courses[course.id] = data;
      console.log(`[prefetchAllCourseData] Successfully cached ${course.id}`);
    } catch (error) {
      console.warn(`[prefetchAllCourseData] Failed to fetch data for course ${course.id}:`, error);
      // Continue with next course even if this one failed
    }
    completed++;
    onProgress(completed);
  }

  console.log(`[prefetchAllCourseData] Prefetch complete. Successfully cached ${Object.keys(prefetchedData.courses).length}/${courses.length} courses`);
  return prefetchedData;
} 