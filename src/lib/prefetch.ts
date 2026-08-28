import type { CourseEnrollmentData } from './api';

export interface PrefetchedData {
  timestamp: number;
  courses: {
    [courseId: string]: CourseEnrollmentData;
  };
}

async function fetchCourseDataFromApi(courseName: string): Promise<CourseEnrollmentData> {
  const response = await fetch(`/api/course-data?course=${encodeURIComponent(courseName)}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch course data: ${response.statusText}`);
  }
  return response.json();
}

export async function prefetchAllCourseData(
  courses: { id: string }[],
  onProgress: (progress: number) => void
): Promise<PrefetchedData> {
  const prefetchedData: PrefetchedData = {
    timestamp: Date.now(),
    courses: {}
  };

  let completed = 0;

  // Process courses sequentially to avoid overwhelming the API
  for (const course of courses) {
    try {
      const data = await fetchCourseDataFromApi(course.id);
      prefetchedData.courses[course.id] = data;
    } catch (error) {
      console.warn(`Failed to fetch data for course ${course.id}:`, error);
      // Continue with next course even if this one failed
    }
    completed++;
    onProgress(completed);
  }

  return prefetchedData;
} 