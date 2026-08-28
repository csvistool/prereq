import { NextRequest, NextResponse } from 'next/server';

interface CourseEnrollmentData {
    currentEnrollment: number;
    pastEnrollment: number;
    yearAgoEnrollment: number;
    threeTermsAgoEnrollment: number;
}

const courseDataCache = new Map<string, { data: CourseEnrollmentData; timestamp: number }>();
const CACHE_DURATION = 1000 * 60 * 60; // 1 hour cache duration
const pendingRequests = new Map<string, Promise<CourseEnrollmentData>>();

async function fetchWithDedup(url: string, cacheKey: string) {
    if (pendingRequests.has(cacheKey)) {
        return pendingRequests.get(cacheKey);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    const promise = fetch(url, { signal: controller.signal }).then(async (response) => {
        clearTimeout(timeout);
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        const data = await response.json();
        pendingRequests.delete(cacheKey);
        return data;
    }).catch((error) => {
        clearTimeout(timeout);
        pendingRequests.delete(cacheKey);
        throw error;
    });

    pendingRequests.set(cacheKey, promise);
    return promise;
}

async function fetchSectionCRNs(term: string, courseName: string) {
    const url = `https://gt-scheduler.github.io/crawler-v2/${term}.json`;
    const cacheKey = `crn-${term}-${courseName}`;

    try {
        const data = await fetchWithDedup(url, cacheKey);
        const CRNList: Record<string, string> = {};

        if (!data.courses[courseName]) {
            return CRNList;
        }

        const courseData = data.courses[courseName];

        let sections;
        if (Array.isArray(courseData)) {
            sections = courseData[1] || {};
        } else {
            sections = courseData;
        }

        for (const section in sections) {
            const sectionData = sections[section];
            if (Array.isArray(sectionData) && sectionData.length >= 3 && sectionData[2] !== 0) {
                CRNList[section] = sectionData[0];
            }
        }

        return CRNList;
    } catch (error) {
        throw error;
    }
}

async function fetchSectionSeatingInfo(term: string, CRN: string) {
    const url = `https://gt-scheduler.azurewebsites.net/proxy/class_section?term=${term}&crn=${CRN}`;

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000); // 8 second timeout

        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        const html = await response.text();
        const seatingInfo: Record<string, string> = {};

        // Parse HTML using regex to extract span contents
        const spanMatches = html.match(/<span[^>]*>([^<]*)<\/span>/g) || [];

        const spanTexts = spanMatches.map(span =>
            span.replace(/<span[^>]*>|<\/span>/g, '').trim()
        );

        for (let i = 0; i < spanTexts.length; i += 2) {
            if (i + 1 < spanTexts.length) {
                const key = spanTexts[i].slice(0, -1);
                const value = spanTexts[i + 1];
                seatingInfo[key] = value;
            }
        }

        return seatingInfo;
    } catch (error) {
        throw error;
    }
}

async function courseSectionSeatingInfoList(term: string, courseName: string) {
    const CRNList = await fetchSectionCRNs(term, courseName);
    const fetchPromises = Object.entries(CRNList).map(async ([section, crn]) => {
        const info = await fetchSectionSeatingInfo(term, crn);
        return [section, info];
    });

    const results = await Promise.all(fetchPromises);
    return Object.fromEntries(results);
}

async function termTotalEnrollment(term: string, courseName: string) {
    const data = await courseSectionSeatingInfoList(term, courseName);
    const totals = {
        'Enrollment Actual': 0,
        'Enrollment Maximum': 0
    };

    for (const section in data) {
        const enrollmentActual = data[section]['Enrollment Actual'];
        const enrollmentMaximum = data[section]['Enrollment Maximum'];

        totals['Enrollment Actual'] += parseInt(enrollmentActual) || 0;
        if (parseInt(enrollmentMaximum) === 0) {
            totals['Enrollment Maximum'] += parseInt(enrollmentActual) || 0;
        } else {
            totals['Enrollment Maximum'] += parseInt(enrollmentMaximum) || 0;
        }
    }
    return totals;
}

async function fetchCourseData(courseName: string): Promise<CourseEnrollmentData> {
    const cachedData = courseDataCache.get(courseName);
    if (cachedData && (Date.now() - cachedData.timestamp < CACHE_DURATION)) {
        return cachedData.data;
    }

    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth() + 1;

    const currentTerm = month >= 8 ? `${year}08` : `${year}02`;
    const pastTerm = month >= 8 ? `${year}02` : `${year - 1}08`;
    const oneYearBack = month >= 8 ? `${year - 1}08` : `${year - 1}02`;
    const threeTermsBack = month >= 8 ? `${year - 1}02` : `${year - 2}08`;

    try {
        const [currentTermData, pastTermData, oneYearBackTermData, threeTermBackData] = await Promise.all([
            termTotalEnrollment(currentTerm, courseName).catch(() => {
                return {'Enrollment Actual': 0, 'Enrollment Maximum': 0};
            }),
            termTotalEnrollment(pastTerm, courseName).catch(() => {
                return {'Enrollment Actual': 0, 'Enrollment Maximum': 0};
            }),
            termTotalEnrollment(oneYearBack, courseName).catch(() => {
                return {'Enrollment Actual': 0, 'Enrollment Maximum': 0};
            }),
            termTotalEnrollment(threeTermsBack, courseName).catch(() => {
                return {'Enrollment Actual': 0, 'Enrollment Maximum': 0};
            })
        ]);

        const data = {
            currentEnrollment: currentTermData['Enrollment Actual'],
            pastEnrollment: pastTermData['Enrollment Actual'],
            yearAgoEnrollment: oneYearBackTermData['Enrollment Actual'],
            threeTermsAgoEnrollment: threeTermBackData['Enrollment Actual']
        };

        courseDataCache.set(courseName, {
            data,
            timestamp: Date.now()
        });

        return data;
    } catch {
        return {
            currentEnrollment: 0,
            pastEnrollment: 0,
            yearAgoEnrollment: 0,
            threeTermsAgoEnrollment: 0
        };
    }
}

export async function GET(request: NextRequest) {
    const courseName = request.nextUrl.searchParams.get('course');

    if (!courseName) {
        return NextResponse.json(
            { error: 'Missing course parameter' },
            { status: 400 }
        );
    }

    try {
        const data = await fetchCourseData(courseName);

        return NextResponse.json(data, {
            headers: {
                'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
                'Access-Control-Allow-Origin': '*'
            }
        });
    } catch (error) {
        return NextResponse.json(
            {
                error: 'Failed to fetch course data',
                details: error instanceof Error ? error.message : String(error),
                course: courseName
            },
            { status: 500 }
        );
    }
}
