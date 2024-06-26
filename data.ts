import fs from 'fs/promises';
import {glob} from 'glob';
import _ from 'lodash';
import * as mathjs from 'mathjs';

type ReviewCourse = {
  subject: string;
  code: string;
  name: string;
};

type Review = {
  semester: string;
  instructors: Instructor[];
  rating_content: number;
  rating_teaching: number;
  rating_grading: number;
  rating_workload: number;
  upvote_count: number;
  vote_count: number;
};

type Instructor = {
  id: number;
  name: string;
  rating: number;
};

async function loadReviews() {
  const files = await glob('data-review/data/**/*.json');
  return (await Promise.all(files.flatMap(async file => {
    const content = await fs.readFile(file, 'utf-8');
    const obj = JSON.parse(content) as {course: ReviewCourse; reviews: Review[]};
    return obj.reviews.map(review => ({
      ...review,
      course: obj.course,
    }));
  }))).flat();
}

type ScheduleQuotaCourse = {
  subject: string;
  course: string;
  name: string;
  sections: ScheduleQuotaSection[];
};

type ScheduleQuotaSection = {
  instructors: string[];
};

async function loadCourses() {
  const coursesFiles = await glob('data-schedule-quota/data/*-slim.json');
  const coursesFile = _.min(coursesFiles)!;
  const coursesJson = await fs.readFile(coursesFile, 'utf-8');
  const coursesJsonObj = JSON.parse(coursesJson) as Record<string, ScheduleQuotaCourse[]>;

  const courses = Object.values(coursesJsonObj).flat();

  return _(courses)
    .flatMap(course =>
      _(course.sections)
        .flatMap(section => section.instructors)
        .uniq() // unique instructors
        .map(instructor => ({
          subject: course.subject,
          course: course.course,
          name: course.name,
          instructor,
        }))
        .value(),
    )
    .groupBy(it => it.instructor)
    .value();
}

export type Rating = {
  rating: number;
  semester: number;
  course: Course;
};

export type Course = {
  subject: string;
  course: string;
  // name: string;
};

export type InstructorRatingObj = {
  id: number;
  name: string;

  samples: number;
  teachRatings: Rating[];
  thumbRatings: Rating[];

  // Courses taught by this instructor this semester.
  courses: Course[];
};

export const EPOCH_YEAR = 2012;

export function parseSemester(string: string): number {
  const seasonMap: Record<string, number> = {
    Fall: 0,
    Winter: 1,
    Spring: 2,
    Summer: 3,
  };

  const [academicYear, season] = string.split(' ');
  const [year] = academicYear.split('-');

  const yearDiff = parseInt(year, 10) - EPOCH_YEAR;
  const semesterNumber = seasonMap[season];

  return (yearDiff * 4) + semesterNumber;
}

export async function preprocess(): Promise<InstructorRatingObj[]> {
  const reviews = await loadReviews();
  const courses = await loadCourses();

  const instructors = _.chain(reviews)
    .flatMap(it => it.instructors)
    .sortBy(it => it.id)
    .uniqBy(it => it.id)
    .value();
  const reviewMap = _.chain(reviews.flatMap(review =>
    review.instructors.map(instructor => ({
      ..._.omit(review, 'instructors'),
      instructor,
    })),
  ))
    .sortBy(it => it.semester)
    .groupBy(it => it.instructor.id)
    .value();

  // Convert to Instructor Rating Object.
  const instructorRatingObj = instructors.map(instructor => {
    const r = reviewMap[instructor.id];
    const teachRatings = r.map(review => {
      const rating = review.rating_teaching;
      const semester = parseSemester(review.semester);
      const {course} = review;
      return {
        rating,
        semester,
        course: {
          subject: course.subject,
          course: course.code,
          // name: course.name,
        },
      } satisfies Rating;
    });
    const thumbRatings = r.map(review => {
      const {rating} = review.instructor;
      const semester = parseSemester(review.semester);
      const {course} = review;
      return {
        rating,
        semester,
        course: {
          subject: course.subject,
          course: course.code,
          // name: course.name,
        },
      } satisfies Rating;
    });

    return {
      id: instructor.id,
      name: instructor.name,
      samples: r.length,
      teachRatings,
      thumbRatings,
      courses: courses[instructor.name]?.map(course => ({
        subject: course.subject,
        course: course.course,
        // name: course.name,
      })) ?? [],
    } satisfies InstructorRatingObj;
  });

  const allThumbRatings = instructorRatingObj
    .flatMap(it => it.thumbRatings)
    .map(it => it.rating);
  const meanThumbRatings = mathjs.mean(...allThumbRatings);
  const stdThumbRatings = mathjs.std(...allThumbRatings);
  const allTeachRatings = instructorRatingObj
    .flatMap(it => it.teachRatings)
    .map(it => it.rating);
  const meanTeachRatings = mathjs.mean(...allTeachRatings);
  const stdTeachRatings = mathjs.std(...allTeachRatings);

  instructorRatingObj.forEach(it => {
    it.thumbRatings.forEach(rating => {
      rating.rating = (rating.rating - meanThumbRatings) / stdThumbRatings;
    });
    it.teachRatings.forEach(rating => {
      rating.rating = (rating.rating - meanTeachRatings) / stdTeachRatings;
    });
  });

  return instructorRatingObj;
}
